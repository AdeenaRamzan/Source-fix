"""
Tests for the LangGraph agent loop in app/agent/{state,nodes,graph}.py.

No real LLM calls anywhere in this file. Every test injects a fake
`llm_call` callable (a plain Python function matching the
`(system_prompt, user_prompt) -> raw_text` signature nodes.py expects)
instead of hitting Groq. This keeps the suite:
  - deterministic (no depending on what a real model happens to say today),
  - fast (no network calls),
  - runnable with no API keys configured at all.

The three cases below are the ones that matter most for this system:

  1. immediate pass -> zero relaxations needed, ledger stays empty.
  2. REGRESSION: a hard constraint is never relaxed, even under repeated
     pressure across multiple forced iterations. This is the single most
     important safety property in the whole project -- see the big comment
     in that test for why.
  3. max_iterations is exhausted -> the graph reaches no_shortlist_found
     cleanly, without looping forever.

A handful of smaller supporting tests for apply_relaxation_node's other
guardrails are included at the end for extra confidence, since that
function is explicitly the most important one in the project.
"""

import json
from datetime import date
from pathlib import Path

import pytest

from app.agent.graph import run_agent
from app.agent.nodes import apply_relaxation_node
from app.agent.state import make_initial_state

DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"

# Same pinned "today" as test_tools.py, for the same reason: certification
# expiry checks must be deterministic no matter when the suite runs.
REFERENCE_DATE = date(2026, 8, 8)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def brief():
    with open(DATA_DIR / "product_brief.json") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def full_constraints(brief):
    return brief["requirements"]


@pytest.fixture(scope="module")
def suppliers():
    with open(DATA_DIR / "suppliers.json") as f:
        return json.load(f)["suppliers"]


def _hard_only(constraints):
    return [c for c in constraints if c["constraint_type"] == "hard"]


def _never_call(label):
    """Build a fake llm_call that fails the test loudly if it's ever
    invoked -- used to assert a code path that should short-circuit before
    reaching the LLM never actually reaches it."""

    def _fn(system_prompt, user_prompt):
        raise AssertionError(f"{label} should never have been called in this scenario")

    return _fn


# ---------------------------------------------------------------------------
# Case 1: at least one supplier passes immediately -- no relaxation needed
# ---------------------------------------------------------------------------

def test_immediate_pass_needs_no_relaxation(suppliers, full_constraints):
    # Using only the three HARD constraints (certification, capacity,
    # quality history), several suppliers already clear the bar with zero
    # relaxation -- confirmed independently: eligibility_filter(hard_only)
    # returns SUP-001, SUP-002, SUP-003, SUP-004, SUP-009, SUP-013.
    hard_only = _hard_only(full_constraints)

    finalize_calls = []

    def fake_finalize(system_prompt, user_prompt):
        finalize_calls.append(user_prompt)
        return json.dumps(
            {
                "ranked_supplier_ids": ["SUP-001"],
                "explanations": {
                    "SUP-001": "Meets the certification, capacity, and quality history requirements per the filter data."
                },
            }
        )

    result = run_agent(
        suppliers,
        hard_only,
        max_iterations=5,
        reference_date=REFERENCE_DATE,
        # propose_relaxation must never be reached on this path -- if it
        # is, that's a bug in decide_next's routing, not something to
        # paper over with a real fake response.
        propose_llm_call=_never_call("propose_relaxation_node"),
        finalize_llm_call=fake_finalize,
    )

    assert result["status"] == "shortlisted"
    assert result["iteration"] == 0, "no relaxation iterations should have run at all"
    assert result["relaxation_ledger"] == [], "ledger must stay empty when nothing was ever proposed"
    assert result["visited_relaxations"] == []
    assert result["working_constraints"] == result["original_constraints"], (
        "constraints must be untouched when no relaxation was needed"
    )
    assert len(finalize_calls) == 1, "finalize should be called exactly once"

    shortlisted_ids = {entry["supplier_id"] for entry in result["final_shortlist"]}
    assert "SUP-001" in shortlisted_ids
    assert result["filter_result"]["eligible"], "filter_result should show eligible suppliers directly"


# ---------------------------------------------------------------------------
# Case 2: REGRESSION TEST -- a hard constraint is NEVER relaxed
# ---------------------------------------------------------------------------

def test_hard_constraint_is_never_relaxed_under_repeated_pressure(suppliers, full_constraints):
    """
    THE most important safety property in this system: apply_relaxation_node
    must reject any proposal that targets a hard constraint, no matter how
    many times the LLM proposes it, and it must do this by checking
    `constraint_type` in our own working_constraints -- never by trusting
    anything the LLM says about its own proposal.

    Why this matters: propose_relaxation_node's system prompt already tells
    the model "only propose soft constraints." Prompts are not a security
    boundary -- an LLM can hallucinate, be jailbroken, or just be wrong.
    apply_relaxation_node is the actual enforcement point, in code, and this
    test is what would catch a regression where someone "simplifies" that
    function to trust the LLM's own labeling instead of re-deriving
    constraint_type from working_constraints.

    We simulate a worst-case LLM: on every single call, across every
    iteration, it proposes relaxing one of the three HARD constraints
    (cycling through all three, to prove this isn't a one-field fluke) with
    a value that -- if it were ever actually applied -- would trivially
    make suppliers eligible. If apply_relaxation_node's guard were broken,
    this test would see working_constraints change and/or an eligible
    supplier show up. It must not.
    """
    hard_fields_cycle = ["certification", "monthly_capacity_units", "quality_history_score"]
    call_count = {"n": 0}

    def malicious_propose(system_prompt, user_prompt):
        field = hard_fields_cycle[call_count["n"] % len(hard_fields_cycle)]
        call_count["n"] += 1
        # certification has no numeric 'value'/'acceptable_values' shape at
        # all, so give it a value that would only make sense if the guard
        # were bypassed; for the numeric ones, propose a wildly permissive
        # threshold that would trivially rescue suppliers if applied.
        if field == "certification":
            new_value = "anything goes"
        elif field == "monthly_capacity_units":
            new_value = 0
        else:  # quality_history_score
            new_value = 0
        return json.dumps(
            {
                "field": field,
                "new_value": new_value,
                "rationale": "adversarial test: attempting to relax a hard constraint",
            }
        )

    def finalize_should_not_run(system_prompt, user_prompt):
        raise AssertionError(
            "finalize should never run in this scenario -- every proposal "
            "targets a hard constraint and must be rejected, so zero "
            "suppliers should ever become eligible and give_up_node should "
            "be reached instead."
        )

    max_iterations = 4
    result = run_agent(
        suppliers,
        full_constraints,
        max_iterations=max_iterations,
        reference_date=REFERENCE_DATE,
        propose_llm_call=malicious_propose,
        finalize_llm_call=finalize_should_not_run,
    )

    # --- The core safety assertion -----------------------------------
    # working_constraints must be byte-for-byte identical to the original
    # brief -- not one value on a hard field (or any field, since nothing
    # valid was ever proposed) may have changed.
    assert result["working_constraints"] == result["original_constraints"], (
        "REGRESSION: a hard constraint's value changed! apply_relaxation_node "
        "must reject every proposal that targets a non-soft constraint, "
        "regardless of what the LLM proposes."
    )

    for field in hard_fields_cycle:
        original = next(c for c in full_constraints if c["field"] == field)
        working = next(c for c in result["working_constraints"] if c["field"] == field)
        assert working.get("value") == original.get("value")
        assert working.get("constraint_type") == "hard"

    # The loop should have exhausted max_iterations and given up cleanly --
    # not because relaxation "worked" and produced a shortlist.
    assert result["iteration"] == max_iterations
    assert result["status"] == "no_shortlist_found"
    assert result["final_shortlist"] == []

    # Every single attempt must be logged as a rejection, with a reason
    # that makes it auditable *why* it was rejected.
    assert len(result["relaxation_ledger"]) == max_iterations
    for entry in result["relaxation_ledger"]:
        assert entry["accepted"] is False
        assert "hard" in entry["reason"].lower() or "soft" in entry["reason"].lower()

    # Nothing was ever legitimately applied, so visited_relaxations (which
    # only tracks applied changes) must stay empty.
    assert result["visited_relaxations"] == []

    # The LLM was in fact invoked every iteration (proves the loop actually
    # ran and wasn't short-circuited some other way).
    assert call_count["n"] == max_iterations


# ---------------------------------------------------------------------------
# Case 3: exhausts max_iterations -> no_shortlist_found, no infinite loop
# ---------------------------------------------------------------------------

def test_exhausting_max_iterations_reaches_no_shortlist_found_without_looping_forever(
    suppliers, full_constraints
):
    # A worst-case LLM that never produces valid JSON at all. This also
    # exercises the "retry once with a stricter reminder" path in
    # propose_relaxation_node -- both the first attempt and the retry will
    # fail to parse, every iteration.
    propose_calls = {"n": 0}

    def garbage_propose(system_prompt, user_prompt):
        propose_calls["n"] += 1
        return "Sure! I'd suggest loosening something, let me think about it..."

    def finalize_should_not_run(system_prompt, user_prompt):
        raise AssertionError("finalize should never run: no proposal ever parsed, so eligible stays empty")

    max_iterations = 3
    result = run_agent(
        suppliers,
        full_constraints,
        max_iterations=max_iterations,
        reference_date=REFERENCE_DATE,
        propose_llm_call=garbage_propose,
        finalize_llm_call=finalize_should_not_run,
    )

    # The graph must terminate -- run_agent returning at all (pytest didn't
    # hang or hit LangGraph's recursion_limit) is itself part of what this
    # test is checking, but we also assert the counters landed exactly
    # where a bounded loop should land them.
    assert result["status"] == "no_shortlist_found"
    assert result["final_shortlist"] == []
    assert result["iteration"] == max_iterations, (
        "iteration must stop exactly at max_iterations, not run past it"
    )
    assert len(result["relaxation_ledger"]) == max_iterations
    assert all(entry["accepted"] is False for entry in result["relaxation_ledger"])
    assert all("json" in entry["reason"].lower() for entry in result["relaxation_ledger"])

    # propose_relaxation_node retries once per iteration on unparseable
    # JSON, so the fake should have been called exactly 2x per iteration.
    assert propose_calls["n"] == max_iterations * 2

    # working_constraints must be completely untouched -- nothing was ever
    # successfully parsed, let alone applied.
    assert result["working_constraints"] == result["original_constraints"]
    assert result["visited_relaxations"] == []


# ---------------------------------------------------------------------------
# Supporting tests for apply_relaxation_node's other guardrails
# (bonus coverage -- apply_relaxation_node is the project's most important
# function, so its individual guards are worth testing in isolation too,
# not just through a full run_agent loop.)
# ---------------------------------------------------------------------------

def test_apply_relaxation_rejects_a_field_that_does_not_exist(suppliers, full_constraints):
    state = make_initial_state(suppliers, full_constraints, max_iterations=5, reference_date=REFERENCE_DATE)
    state["pending_relaxation"] = {"field": "warranty_years", "new_value": 2, "rationale": "n/a"}

    update = apply_relaxation_node(state)

    assert "working_constraints" not in update, "no working_constraints key should be returned when rejecting"
    assert update["iteration"] == 1
    assert update["relaxation_ledger"][0]["accepted"] is False
    assert "does not exist" in update["relaxation_ledger"][0]["reason"]


def test_apply_relaxation_rejects_shape_mismatch_scalar_for_categorical_field(suppliers, full_constraints):
    # 'region' is categorical (acceptable_values); proposing a bare scalar
    # for it is a malformed proposal and must be rejected, not coerced.
    state = make_initial_state(suppliers, full_constraints, max_iterations=5, reference_date=REFERENCE_DATE)
    state["pending_relaxation"] = {"field": "region", "new_value": "Anywhere", "rationale": "n/a"}

    update = apply_relaxation_node(state)

    assert "working_constraints" not in update
    assert update["relaxation_ledger"][0]["accepted"] is False
    assert "categorical" in update["relaxation_ledger"][0]["reason"]


def test_apply_relaxation_accepts_a_valid_soft_relaxation_and_logs_it(suppliers, full_constraints):
    state = make_initial_state(suppliers, full_constraints, max_iterations=5, reference_date=REFERENCE_DATE)
    state["pending_relaxation"] = {"field": "moq_units", "new_value": 7000, "rationale": "widen MOQ ceiling"}

    update = apply_relaxation_node(state)

    assert update["iteration"] == 1
    new_moq = next(c for c in update["working_constraints"] if c["field"] == "moq_units")
    assert new_moq["value"] == 7000
    assert update["relaxation_ledger"][0]["accepted"] is True
    assert update["visited_relaxations"] == [{"field": "moq_units", "new_value": 7000}]
    # original_constraints (not part of this update, but let's confirm the
    # source list used to build state wasn't mutated by the node)
    assert full_constraints[3]["field"] == "moq_units"
    assert full_constraints[3]["value"] == 5000, "the module-level fixture constraints must never be mutated"
