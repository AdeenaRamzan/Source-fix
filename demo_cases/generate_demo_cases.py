"""
sourcefix.demo_cases.generate_demo_cases
==========================================

Produces the three demo cases the submission brief requires (successful /
ambiguous / failure), against the real, bundled synthetic dataset
(app/data/suppliers.json + app/data/product_brief.json), by driving the
actual FastAPI app (app/main.py) through Starlette's TestClient -- the same
request/response cycle a real HTTP client would get from `uvicorn app.main:app`.

IMPORTANT -- about the LLM calls in cases 1 and 3:
    This sandbox has no live GROQ_API_KEY configured, so running /api/analyze
    for real would just fail closed with "API key not set" (as demonstrated
    separately). To still exercise the real graph, real guardrails, and real
    API contract end-to-end, this script monkeypatches
    app.agent.graph._default_groq_call and _default_groq_finalize_call with
    small, deterministic stand-ins that return the kind of response a real
    Groq call would return for this exact prompt -- nothing about the graph,
    the guards in apply_relaxation_node, or the FastAPI layer is faked.
    This is the same dependency-injection seam the project's own test suite
    (tests/test_agent.py) already uses for exactly this reason. Swap in
    a real API key and delete the monkeypatches to reproduce these same
    cases against a live model.

Case 2 (ambiguous) and the /api/baseline calls in every case never touch an
LLM at all -- eligibility_filter is pure deterministic code -- so those
parts of the output are real, unmodified, and reproducible byte-for-byte by
anyone who runs this script.

Run with:  ./backend/.venv/bin/python demo_cases/generate_demo_cases.py
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.testclient import TestClient  # noqa: E402

import app.agent.graph as graph_module  # noqa: E402
from app.main import app  # noqa: E402
from app.agent.tools import cite_lookup  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "app" / "data"

REFERENCE_DATE = "2026-08-08"  # pinned "today" -- same convention as tests/test_agent.py

client = TestClient(app)

with open(DATA_DIR / "suppliers.json") as f:
    ALL_SUPPLIERS = json.load(f)["suppliers"]

with open(DATA_DIR / "product_brief.json") as f:
    FULL_CONSTRAINTS = json.load(f)["requirements"]


def _post(path: str, body: dict) -> dict:
    start = time.perf_counter()
    resp = client.post(path, json=body)
    elapsed_ms = round((time.perf_counter() - start) * 1000, 2)
    return {
        "request": {"method": "POST", "path": path, "body": body},
        "response": {"status_code": resp.status_code, "body": resp.json()},
        "elapsed_ms": elapsed_ms,
    }


def _save(name: str, payload: dict) -> None:
    out_path = OUT_DIR / name
    with open(out_path, "w") as f:
        json.dump(payload, f, indent=2)
    print(f"wrote {out_path.relative_to(OUT_DIR.parent)}")


# ---------------------------------------------------------------------------
# Case 1: SUCCESSFUL -- 0-eligible baseline -> relaxation -> ranked shortlist
# ---------------------------------------------------------------------------

def build_case_1():
    # Step A: the non-agent baseline, full (unrelaxed) constraints. Expected
    # (and confirmed independently via tests/test_tools.py + the data
    # dictionary's own worked example): zero suppliers pass every
    # requirement -- moq_units/lead_time_days/region/sustainability_score
    # soft misses are each one field short of otherwise-clean records.
    baseline = _post(
        "/api/baseline",
        {"reference_date": REFERENCE_DATE},
    )
    assert baseline["response"]["body"]["eligible"] == [], (
        "expected the zero-eligible baseline this dataset is designed to produce"
    )

    # Step B: the real agent loop. sustainability_score is the soft
    # constraint with the most current failures (SUP-001 at 55, SUP-009
    # missing entirely, SUP-011 at 58, SUP-013 at 59 -- 4 suppliers vs. 2-3
    # for every other soft field), so a reasonable propose_relaxation call
    # picks it first, same as a real Groq call would given the failure
    # counts in its prompt.
    def fake_groq_relax_sustainability(system_prompt, user_prompt, model="llama-3.3-70b-versatile"):
        assert "sustainability_score" in user_prompt  # sanity: field is in the candidate list
        return json.dumps(
            {
                "field": "sustainability_score",
                "new_value": 50,
                "rationale": (
                    "sustainability_score has the most current soft-constraint failures "
                    "(4 suppliers); SUP-001 (55) and SUP-013 (59) are both close misses "
                    "with every other requirement already satisfied, so lowering the "
                    "floor to 50 is the single change most likely to rescue an eligible "
                    "supplier without touching any hard requirement."
                ),
            }
        )

    def fake_groq_rank(system_prompt, user_prompt, model="llama-3.3-70b-versatile"):
        payload = json.loads(user_prompt.split("Rank them and explain using ONLY this data:\n\n", 1)[1])
        eligible = payload["eligible_supplier_ids"]
        assert set(eligible) == {"SUP-001", "SUP-013"}, eligible
        return json.dumps(
            {
                "ranked_supplier_ids": ["SUP-013", "SUP-001"],
                "explanations": {
                    "SUP-013": (
                        "Passes every requirement after the sustainability_score relaxation "
                        "(sustainability_score=59, the higher of the two eligible suppliers, "
                        "vs. a 50 floor). certification is ISO9001/valid, monthly_capacity_units="
                        "22000 (>= 20000), quality_history_score=90 (>= 85), moq_units=4600 "
                        "(<= 5000), lead_time_days=39 (<= 45), region='North America' is in the "
                        "acceptable set."
                    ),
                    "SUP-001": (
                        "Also passes every requirement after the relaxation: certification is "
                        "ISO9001/valid, monthly_capacity_units=25000 (>= 20000, the higher of "
                        "the two eligible suppliers), quality_history_score=90 (>= 85), "
                        "moq_units=3000 (<= 5000), lead_time_days=40 (<= 45), region='North "
                        "America' is in the acceptable set, and sustainability_score=55 clears "
                        "the relaxed 50 floor though not the original 60. Ranked second only "
                        "because sustainability_score is lower than SUP-013's; capacity is "
                        "higher, so treat these two as close on overall fit."
                    ),
                },
            }
        )

    original_groq = graph_module._default_groq_call
    original_groq_finalize = graph_module._default_groq_finalize_call
    graph_module._default_groq_call = fake_groq_relax_sustainability
    graph_module._default_groq_finalize_call = fake_groq_rank
    try:
        analyze = _post(
            "/api/analyze",
            {"max_iterations": 5, "reference_date": REFERENCE_DATE},
        )
    finally:
        graph_module._default_groq_call = original_groq
        graph_module._default_groq_finalize_call = original_groq_finalize

    body = analyze["response"]["body"]
    assert body["status"] == "shortlisted"
    assert body["iteration"] == 1
    assert {e["supplier_id"] for e in body["final_shortlist"]} == {"SUP-001", "SUP-013"}
    assert body["relaxation_ledger"][0]["accepted"] is True

    _save(
        "case1_successful_relaxation.json",
        {
            "case": "successful",
            "description": (
                "0-eligible baseline (full, unrelaxed constraints) -> one accepted "
                "soft-constraint relaxation -> ranked, cited shortlist."
            ),
            "llm_calls_note": (
                "propose_relaxation_node and rank_and_finalize_node were called with "
                "deterministic stand-in functions (no live GROQ_API_KEY in this sandbox); "
                "the graph, guardrails, and FastAPI layer are all real. "
                "See generate_demo_cases.py for the exact stand-in responses used."
            ),
            "step_A_baseline_zero_eligible": baseline,
            "step_B_agent_run": analyze,
        },
    )


# ---------------------------------------------------------------------------
# Case 2: AMBIGUOUS -- SUP-008's conflicting certification record
# ---------------------------------------------------------------------------

def build_case_2():
    # Purely deterministic: eligibility_filter has no LLM in its call path
    # at all, so this is exactly what /api/baseline (and the first
    # run_filter pass inside /api/analyze) always returns for this
    # supplier, byte-for-byte, no stand-ins needed.
    baseline = _post(
        "/api/baseline",
        {"reference_date": REFERENCE_DATE},
    )
    body = baseline["response"]["body"]

    sup008_result = body["results"]["SUP-008"]
    assert "SUP-008" not in body["eligible"], "SUP-008 must be excluded from the eligible set"
    cert_entry = sup008_result["certification"]
    assert cert_entry["passed"] is False
    assert "AMBIGUOUS" in cert_entry["reason"], (
        "the exclusion reason must explicitly flag the conflict, not silently fail"
    )

    # Supplementary citation back to the raw source record (source_row),
    # via tools.cite_lookup -- called directly here since it's a read-only
    # lookup helper, not exposed as its own HTTP endpoint.
    citations = {
        "certification.status": cite_lookup(ALL_SUPPLIERS, "SUP-008", "certification.status"),
        "certification.expiry_date": cite_lookup(ALL_SUPPLIERS, "SUP-008", "certification.expiry_date"),
    }

    _save(
        "case2_ambiguous_certification.json",
        {
            "case": "ambiguous",
            "description": (
                "SUP-008 (Meridian Tooling Ltd.) has a certification record where "
                "status='expired' but expiry_date is in the future relative to the "
                "pinned reference date -- a conflicting/ambiguous source record. "
                "check_constraint() detects the status/date disagreement and fails the "
                "supplier CLOSED with an explicit reason, rather than guessing which "
                "field to trust."
            ),
            "llm_calls_note": "No LLM involved -- eligibility_filter is pure deterministic code.",
            "baseline_call": baseline,
            "sup008_certification_field_result": cert_entry,
            "sup008_excluded_from_eligible": "SUP-008" not in body["eligible"],
            "supporting_citations_to_raw_source_data": citations,
        },
    )


# ---------------------------------------------------------------------------
# Case 3: FAILURE -- every candidate fails on a HARD (non-negotiable) field,
# so no amount of soft relaxation, and no amount of max_iterations, can ever
# produce a shortlist.
# ---------------------------------------------------------------------------

def build_case_3():
    # Constructed supplier pool: every one of these suppliers fails at
    # least one HARD requirement (certification / monthly_capacity_units /
    # quality_history_score), independently confirmed against
    # /api/baseline's full-dataset output:
    #   SUP-005 capacity=18000 (<20000)      SUP-010 capacity=19000, quality=78
    #   SUP-006 quality=80 (<85)             SUP-011 quality=84 (<85)
    #   SUP-007 certification expired        SUP-012 quality=83 (<85)
    #   SUP-008 certification ambiguous
    # Since apply_relaxation_node never relaxes a hard constraint no matter
    # what is proposed, this pool is unrescuable by design -- a clean,
    # reproducible failure case that doesn't require an adversarial LLM,
    # only an ordinary one proposing ordinary (accepted) soft relaxations
    # that simply aren't the real blocker.
    failure_pool_ids = {"SUP-005", "SUP-006", "SUP-007", "SUP-008", "SUP-010", "SUP-011", "SUP-012"}
    failure_suppliers = [s for s in ALL_SUPPLIERS if s["source_id"] in failure_pool_ids]
    assert len(failure_suppliers) == len(failure_pool_ids)

    soft_relax_cycle = [
        ("sustainability_score", 40),
        ("moq_units", 8000),
        ("lead_time_days", 60),
    ]
    call_count = {"n": 0}

    def fake_groq_good_faith_but_insufficient(system_prompt, user_prompt, model="llama-3.3-70b-versatile"):
        field, new_value = soft_relax_cycle[call_count["n"] % len(soft_relax_cycle)]
        call_count["n"] += 1
        return json.dumps(
            {
                "field": field,
                "new_value": new_value,
                "rationale": f"Widening {field} to {new_value} to try to rescue an eligible supplier.",
            }
        )

    def fake_groq_finalize_should_never_run(system_prompt, user_prompt, model="llama-3.3-70b-versatile"):
        raise AssertionError(
            "rank_and_finalize_node should never run in this case: every supplier in "
            "the pool fails a HARD requirement, so eligible must stay empty through "
            "every iteration and give_up_node must be reached instead."
        )

    original_groq = graph_module._default_groq_call
    original_groq_finalize = graph_module._default_groq_finalize_call
    graph_module._default_groq_call = fake_groq_good_faith_but_insufficient
    graph_module._default_groq_finalize_call = fake_groq_finalize_should_never_run
    try:
        analyze = _post(
            "/api/analyze",
            {
                "suppliers": failure_suppliers,
                "constraints": FULL_CONSTRAINTS,
                "max_iterations": 3,
                "reference_date": REFERENCE_DATE,
            },
        )
    finally:
        graph_module._default_groq_call = original_groq
        graph_module._default_groq_finalize_call = original_groq_finalize

    body = analyze["response"]["body"]
    assert body["status"] == "no_shortlist_found"
    assert body["final_shortlist"] == []
    assert body["iteration"] == 3
    assert "manual review needed" in body["message"].lower()
    assert all(entry["accepted"] is True for entry in body["relaxation_ledger"]), (
        "in this case the proposals ARE valid soft relaxations and get accepted -- "
        "they just don't help, because the real blockers are hard constraints"
    )

    _save(
        "case3_failure_manual_review.json",
        {
            "case": "failure",
            "description": (
                "A constructed 7-supplier pool where every candidate fails at least "
                "one HARD requirement (certification / capacity / quality history). "
                "The agent proposes three ordinary, good-faith soft-constraint "
                "relaxations across 3 iterations -- each one is validly accepted by "
                "apply_relaxation_node -- but none can ever produce an eligible "
                "supplier, because hard constraints are never relaxed. max_iterations "
                "is exhausted and give_up_node reports a clear, final status."
            ),
            "llm_calls_note": (
                "propose_relaxation_node used a deterministic stand-in proposing "
                "ordinary soft relaxations (no live API key in this sandbox); "
                "rank_and_finalize_node's stand-in asserts it is never called at all, "
                "which the run confirms."
            ),
            "supplier_pool_ids": sorted(failure_pool_ids),
            "agent_run": analyze,
        },
    )


if __name__ == "__main__":
    build_case_1()
    build_case_2()
    build_case_3()
    print("\nAll three demo cases generated successfully.")
