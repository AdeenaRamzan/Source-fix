"""
sourcefix.agent.nodes
======================

The LangGraph nodes that wrap the deterministic core (tools.py) with an LLM
negotiation loop.

Only two nodes ever call an LLM at all:

    propose_relaxation_node   -- Groq (fast/cheap, runs many times)
    rank_and_finalize_node    -- Groq (careful, runs exactly once)

Every other node -- run_filter_node, decide_next, apply_relaxation_node,
give_up_node -- is pure, deterministic Python, same as tools.py.

apply_relaxation_node is the most important function in this file (see its
docstring): it is the ONLY thing standing between "the LLM suggested
something" and "the working constraints actually changed," and it does not
trust the LLM's own labeling of what it proposed. It re-derives
constraint_type from working_constraints -- our own ground truth -- every
time.

LLM calls are injected, not hardcoded. Every node that calls an LLM takes an
optional `llm_call: LLMCallFn` parameter; production wiring (graph.py)
defaults it to a real Groq API call, and tests inject a fake callable so
the test suite never needs network access or API keys, and never becomes
flaky because of what an actual model happens to say.
"""

from __future__ import annotations

import copy
import json
import os
from typing import Any, Callable, Dict, List, Optional

from .state import AgentState
from .tools import count_failures_by_field, eligibility_filter

# A callable that takes (system_prompt, user_prompt) and returns raw text.
LLMCallFn = Callable[[str, str], str]


# ---------------------------------------------------------------------------
# Default (real) LLM callables -- used only when a node is invoked without an
# explicit llm_call, i.e. in production wiring via graph.py. Tests never hit
# these paths.
# ---------------------------------------------------------------------------

def _default_groq_call(
    system_prompt: str,
    user_prompt: str,
    model: str = "llama-3.3-70b-versatile",
) -> str:
    """
    Real call to Groq's OpenAI-compatible chat completions endpoint.
    Used for propose_relaxation_node: this node runs multiple times per
    session (once per relaxation attempt) and its output is always
    re-validated in code by apply_relaxation_node regardless of what it
    says, so a fast/cheap model is the right tradeoff here.

    Model choice: "llama-3.3-70b-versatile" is used by default. If your
    Groq account instead has access to "openai/gpt-oss-20b", pass
    model="openai/gpt-oss-20b" via functools.partial when wiring the graph
    (see graph.build_graph) -- whichever is available on your key.
    """
    import urllib.error
    import urllib.request

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set; cannot call Groq for propose_relaxation_node."
        )

    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = json.loads(resp.read())
    return body["choices"][0]["message"]["content"]


def _default_groq_finalize_call(
    system_prompt: str,
    user_prompt: str,
    model: str = "llama-3.3-70b-versatile",
) -> str:
    """
    Real call to Groq's OpenAI-compatible chat completions endpoint.
    Used for rank_and_finalize_node: this is the one LLM output judges
    will actually read and scrutinize for unsupported claims, and it runs
    exactly once per session.  We use the same Groq API as
    propose_relaxation_node but with a longer timeout since accuracy
    matters more than latency here.

    Model choice: "llama-3.3-70b-versatile" is the largest/most capable
    model available on standard Groq keys and is used by default.
    """
    import urllib.error
    import urllib.request

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError(
            "GROQ_API_KEY is not set; cannot call Groq for rank_and_finalize_node."
        )

    payload = json.dumps(
        {
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        body = json.loads(resp.read())
    return body["choices"][0]["message"]["content"]


# ---------------------------------------------------------------------------
# JSON parsing helper, shared by both LLM-calling nodes
# ---------------------------------------------------------------------------

def _try_parse_json(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """Best-effort parse of an LLM response as a single JSON object.

    Defensively strips a markdown code fence if present (models asked for
    "JSON only" still sometimes wrap it in ```json ... ```), but does not
    try to be clever beyond that. Returns None -- never raises -- so
    callers can decide how to handle a bad response instead of crashing the
    graph on a malformed LLM output.
    """
    if not raw or not isinstance(raw, str):
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:]
        text = text.strip()
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None
    if not isinstance(parsed, dict):
        return None
    return parsed


# ---------------------------------------------------------------------------
# run_filter_node -- deterministic
# ---------------------------------------------------------------------------

def run_filter_node(state: AgentState) -> Dict[str, Any]:
    """Re-run the deterministic eligibility filter against the current
    working_constraints. No LLM involved; this is a thin wrapper around
    tools.eligibility_filter so the graph has a node to loop back to."""
    filter_result = eligibility_filter(
        state["suppliers"],
        state["working_constraints"],
        reference_date=state.get("reference_date"),
    )
    return {"filter_result": filter_result}


# ---------------------------------------------------------------------------
# decide_next -- deterministic router
# ---------------------------------------------------------------------------

def decide_next(state: AgentState) -> str:
    """Router used as the conditional edge out of run_filter.

    Returns one of "finalize", "give_up", "propose_relaxation". Pure
    function of state -- no side effects, no LLM calls -- so the control
    flow of the whole agent is easy to reason about and to unit test in
    isolation from the graph.
    """
    filter_result = state.get("filter_result") or {}
    if filter_result.get("eligible"):
        return "finalize"
    if state["iteration"] >= state["max_iterations"]:
        return "give_up"
    return "propose_relaxation"


# ---------------------------------------------------------------------------
# propose_relaxation_node -- the ONLY node allowed to suggest a relaxation
# ---------------------------------------------------------------------------

_PROPOSE_SYSTEM_PROMPT = """You are the relaxation-proposal component of a sourcing negotiation agent.

Zero suppliers currently meet every requirement. Your job is to suggest ONE
soft (negotiable) requirement to loosen, and a specific new value for it, to
try to rescue at least one eligible supplier on the next pass.

Hard rules:
- You may ONLY choose a field from the "soft constraints" list you are given.
  Never propose a hard/non-negotiable constraint -- it will be rejected.
- Never propose a field that is not in the list you were given.
- Do not repeat a relaxation that is listed as already tried.
- Respond with a single JSON object and NOTHING else: no prose, no markdown
  code fences, no commentary before or after it.

Required JSON shape:
{"field": "<one of the given soft constraint field names>", "new_value": <number, or a list for categorical fields>, "rationale": "<one short sentence>"}
"""


def _build_propose_user_prompt(
    soft_constraints: List[Dict[str, Any]],
    soft_failure_counts: Dict[str, int],
    already_tried: List[Dict[str, Any]],
) -> str:
    lines = ["Soft constraints currently in play (choose ONLY from these):"]
    for c in soft_constraints:
        current = c.get("acceptable_values", c.get("value"))
        fails = soft_failure_counts.get(c["field"], 0)
        lines.append(
            f'- field="{c["field"]}", current_value={current!r}, '
            f"suppliers_currently_failing_this={fails}"
        )

    if already_tried:
        lines.append("\nRelaxations already applied this run (do not repeat):")
        for t in already_tried:
            lines.append(f'- field="{t.get("field")}", new_value={t.get("new_value")!r}')
    else:
        lines.append("\nNo relaxations have been applied yet.")

    lines.append(
        "\nPick the soft constraint most likely to rescue an eligible supplier "
        "and propose a specific, meaningfully-relaxed new_value for it. "
        "Respond with JSON only."
    )
    return "\n".join(lines)


def propose_relaxation_node(
    state: AgentState,
    llm_call: Optional[LLMCallFn] = None,
) -> Dict[str, Any]:
    """Ask an LLM which soft constraint to loosen, and to what.

    This node is the ONLY place in the graph that calls an LLM to decide
    *what* to change. It is deliberately given no ability to touch
    working_constraints itself -- it only returns a proposal in
    `pending_relaxation`, which apply_relaxation_node then validates and
    either applies or rejects. If the LLM's response isn't valid JSON, we
    retry once with a stricter "JSON only" reminder; if that also fails, we
    hand apply_relaxation_node an explicit failure marker rather than
    guessing at a proposal.
    """
    llm_call = llm_call or _default_groq_call

    soft_constraints = [
        c for c in state["working_constraints"] if c.get("constraint_type") == "soft"
    ]
    fail_counts = count_failures_by_field(state["filter_result"]) if state.get("filter_result") else {}
    soft_failure_counts = {c["field"]: fail_counts.get(c["field"], 0) for c in soft_constraints}
    already_tried = state.get("visited_relaxations", [])

    user_prompt = _build_propose_user_prompt(soft_constraints, soft_failure_counts, already_tried)

    raw = llm_call(_PROPOSE_SYSTEM_PROMPT, user_prompt)
    proposal = _try_parse_json(raw)

    if proposal is None:
        stricter_prompt = (
            user_prompt
            + "\n\nSTRICT REMINDER: your previous response was not valid JSON. "
            "Reply with ONLY a single valid JSON object -- no markdown fences, "
            "no explanation, nothing before or after the JSON."
        )
        raw_retry = llm_call(_PROPOSE_SYSTEM_PROMPT, stricter_prompt)
        proposal = _try_parse_json(raw_retry)

    if proposal is None:
        # Both attempts failed to produce parseable JSON. We do NOT guess a
        # proposal on the model's behalf -- we hand apply_relaxation_node an
        # explicit failure marker, which it will fail closed on (reject,
        # burn an iteration, apply nothing).
        return {"pending_relaxation": {"_parse_failed": True, "raw": raw}}

    return {"pending_relaxation": proposal}


# ---------------------------------------------------------------------------
# apply_relaxation_node -- THE deterministic safety checkpoint
# ---------------------------------------------------------------------------

def apply_relaxation_node(state: AgentState) -> Dict[str, Any]:
    """Validate and (maybe) apply the LLM's relaxation proposal.

    THIS IS THE MOST IMPORTANT FUNCTION IN THE WHOLE PROJECT.

    It is the single deterministic gate between "an LLM suggested
    something" and "the system's actual constraints changed." It does not
    trust anything the LLM said about its own proposal -- not the field
    name, not whether the field is "soft," nothing. Instead it re-derives
    ground truth by looking the field up in `working_constraints` (code we
    control, populated from product_brief.json, never touched by the LLM)
    and checking `constraint_type` there.

    If the proposal:
      - failed to parse as JSON at all,
      - names a field that doesn't exist in working_constraints,
      - names a field whose constraint_type is anything other than "soft"
        (this explicitly includes "hard" -- a hard constraint is NEVER
        relaxed, no matter how the LLM frames the request), or
      - supplies a value of the wrong shape for that field (e.g. a list for
        a numeric constraint),
    then the proposal is REJECTED: nothing in working_constraints changes,
    the rejection and its reason are recorded in relaxation_ledger, and the
    iteration counter still advances (so a misbehaving or compromised LLM
    can't stall the loop -- it just burns iterations until max_iterations
    is hit and give_up_node takes over).

    Only a proposal that survives every one of those checks results in a
    new working_constraints (a fresh deep copy -- the old one is never
    mutated in place) and a new entry in both relaxation_ledger and
    visited_relaxations.
    """
    proposal = state.get("pending_relaxation")
    iteration = state["iteration"] + 1
    ledger = list(state.get("relaxation_ledger", []))
    visited = list(state.get("visited_relaxations", []))
    working_constraints = state["working_constraints"]

    def _reject(reason: str) -> Dict[str, Any]:
        entry = {
            "iteration": iteration,
            "proposal": proposal,
            "accepted": False,
            "reason": reason,
        }
        return {
            "iteration": iteration,
            "relaxation_ledger": ledger + [entry],
            "pending_relaxation": None,
        }

    # --- Guard 1: the proposal must exist and have parsed as JSON --------
    if not proposal or proposal.get("_parse_failed"):
        return _reject(
            "propose_relaxation_node did not produce valid JSON (even after "
            "one retry); no relaxation applied."
        )

    field = proposal.get("field")
    if not isinstance(field, str) or "new_value" not in proposal:
        return _reject(
            "Proposal is missing a string 'field' and/or a 'new_value' key; "
            "malformed proposal, rejected without applying anything."
        )
    new_value = proposal["new_value"]

    # --- Guard 2: the field must actually exist in our own ground truth --
    target = next((c for c in working_constraints if c.get("field") == field), None)
    if target is None:
        return _reject(
            f"Proposal targets field '{field}', which does not exist in "
            f"working_constraints. Rejected without applying anything."
        )

    # --- Guard 3 (THE critical check): field must be soft, per OUR data --
    # We never take the LLM's word for whether something is negotiable.
    # constraint_type is read straight from working_constraints, which is
    # derived from product_brief.json and never written to by the LLM.
    constraint_type = target.get("constraint_type")
    if constraint_type != "soft":
        return _reject(
            f"Proposal targets field '{field}' with constraint_type="
            f"'{constraint_type}'. Only constraints explicitly marked "
            f"'soft' in working_constraints may ever be relaxed -- hard "
            f"constraints are non-negotiable by design. Rejected without "
            f"applying anything."
        )

    # --- Guard 4: the new_value's shape must match the constraint's shape
    is_categorical = "acceptable_values" in target
    if is_categorical and not isinstance(new_value, (list, tuple)):
        return _reject(
            f"Field '{field}' is a categorical (acceptable_values) "
            f"constraint but the proposal supplied a scalar new_value. "
            f"Rejected without applying anything."
        )
    if not is_categorical and isinstance(new_value, (list, tuple)):
        return _reject(
            f"Field '{field}' is a numeric constraint but the proposal "
            f"supplied a list new_value. Rejected without applying anything."
        )

    # --- Guard 5: don't bother re-applying an identical already-tried change
    already_applied = any(
        v.get("field") == field and v.get("new_value") == new_value for v in visited
    )
    if already_applied:
        return _reject(
            f"Relaxation (field='{field}', new_value={new_value!r}) was "
            f"already applied earlier this run and evidently wasn't enough "
            f"on its own; not re-applying the identical change."
        )

    # --- All guards passed: apply for real, on a fresh deep copy ---------
    new_constraints = copy.deepcopy(working_constraints)
    new_target = next(c for c in new_constraints if c["field"] == field)
    old_value = new_target.get("acceptable_values", new_target.get("value"))

    if is_categorical:
        new_target["acceptable_values"] = list(new_value)
    else:
        new_target["value"] = new_value

    ledger_entry = {
        "iteration": iteration,
        "field": field,
        "old_value": old_value,
        "new_value": new_value,
        "rationale": proposal.get("rationale", ""),
        "accepted": True,
    }

    return {
        "iteration": iteration,
        "working_constraints": new_constraints,
        "relaxation_ledger": ledger + [ledger_entry],
        "visited_relaxations": visited + [{"field": field, "new_value": new_value}],
        "pending_relaxation": None,
    }


# ---------------------------------------------------------------------------
# rank_and_finalize_node -- the one careful LLM call
# ---------------------------------------------------------------------------

_FINALIZE_SYSTEM_PROMPT = """You are the final-ranking component of a sourcing negotiation agent.

You will be given the deterministic eligibility-filter's own output for
suppliers that already passed every current requirement, plus the exact
field values that filter evaluated. Rank these suppliers and explain your
ranking.

ABSOLUTE RULES:
- You must not state ANY fact, number, or claim about a supplier that is not
  literally present in the data you were given below. No outside knowledge
  about companies, regions, certifications, or industry norms.
- Every sentence of every explanation must be traceable to a specific field
  and value in the provided data.
- If you don't have a real, data-grounded reason to prefer one eligible
  supplier over another, say they are tied on the criteria available rather
  than inventing a differentiator.
- Do not speculate about anything not in the data (price, reliability,
  reputation, etc. beyond what's given).
- Respond with a single JSON object and NOTHING else: no prose, no markdown
  fences, no commentary before or after it.

Required JSON shape:
{"ranked_supplier_ids": ["<supplier_id>", ...], "explanations": {"<supplier_id>": "<short, fully data-grounded explanation>", ...}}
"""


def _build_finalize_user_prompt(state: AgentState) -> str:
    filter_result = state["filter_result"]
    eligible_ids = filter_result["eligible"]
    filter_breakdown = {sid: filter_result["results"][sid] for sid in eligible_ids}

    supplier_lookup = {s.get("source_id", s.get("supplier_id")): s for s in state["suppliers"]}
    # Only forward the exact fields the filter itself evaluated, so the
    # model has no path to reach for supplier facts outside the filter's
    # own output data (e.g. it never sees "notes" or "country").
    supplier_field_values = {
        sid: {field: supplier_lookup[sid].get(field) for field in filter_breakdown[sid].keys()}
        for sid in eligible_ids
    }

    payload = {
        "eligible_supplier_ids": eligible_ids,
        "filter_breakdown": filter_breakdown,
        "supplier_field_values": supplier_field_values,
    }
    return (
        "Here is the complete, ground-truth data for every eligible supplier. "
        "Rank them and explain using ONLY this data:\n\n"
        + json.dumps(payload, indent=2, default=str)
    )


def rank_and_finalize_node(
    state: AgentState,
    llm_call: Optional[LLMCallFn] = None,
) -> Dict[str, Any]:
    """Rank the eligible suppliers and write a grounded explanation.

    This is the one LLM call in the whole system whose output judges (or a
    real buyer) will actually read and scrutinize for unsupported claims,
    so it uses Groq with llama-3.3-70b-versatile (the largest/most capable
    model available) and runs exactly once per session rather than in a
    loop.

    If the model's response isn't valid JSON even after one retry, this
    node does NOT fabricate a ranking or explanation -- it falls back to
    the filter's own eligible order with no invented commentary, which is
    always a safe, fully-grounded (if less polished) result.
    """
    llm_call = llm_call or _default_groq_finalize_call

    filter_result = state["filter_result"]
    eligible_ids = filter_result["eligible"]
    user_prompt = _build_finalize_user_prompt(state)

    raw = llm_call(_FINALIZE_SYSTEM_PROMPT, user_prompt)
    parsed = _try_parse_json(raw)

    if parsed is None:
        stricter_prompt = (
            user_prompt
            + "\n\nSTRICT REMINDER: your previous response was not valid JSON. "
            "Reply with ONLY a single valid JSON object -- no markdown fences, "
            "no explanation, nothing before or after the JSON."
        )
        raw_retry = llm_call(_FINALIZE_SYSTEM_PROMPT, stricter_prompt)
        parsed = _try_parse_json(raw_retry)

    attempts = state["iteration"]
    attempts_phrase = (
        "with no relaxation needed"
        if attempts == 0
        else f"after {attempts} relaxation attempt{'s' if attempts != 1 else ''}"
    )

    if parsed is None or not isinstance(parsed.get("ranked_supplier_ids"), list):
        # Safe, fully-grounded fallback: no fabricated ranking rationale.
        shortlist = [{"supplier_id": sid, "explanation": None} for sid in eligible_ids]
        return {
            "final_shortlist": shortlist,
            "status": "shortlisted",
            "message": (
                f"Shortlisted {len(shortlist)} supplier(s) {attempts_phrase} "
                f"(ranking explanation unavailable -- LLM response could not "
                f"be parsed after retry)."
            ),
        }

    # Only keep ranked ids that are actually eligible -- never let the model
    # introduce a supplier that didn't pass the deterministic filter.
    ranked_ids = [sid for sid in parsed["ranked_supplier_ids"] if sid in eligible_ids]
    # Any eligible supplier the model dropped from its ranking is appended
    # at the end rather than silently disappearing from the shortlist.
    for sid in eligible_ids:
        if sid not in ranked_ids:
            ranked_ids.append(sid)

    explanations = parsed.get("explanations")
    if not isinstance(explanations, dict):
        explanations = {}

    shortlist = [
        {"supplier_id": sid, "explanation": explanations.get(sid)} for sid in ranked_ids
    ]
    return {
        "final_shortlist": shortlist,
        "status": "shortlisted",
        "message": f"Shortlisted {len(shortlist)} supplier(s) {attempts_phrase}.",
    }


# ---------------------------------------------------------------------------
# give_up_node -- deterministic
# ---------------------------------------------------------------------------

def give_up_node(state: AgentState) -> Dict[str, Any]:
    """Reached when max_iterations is exhausted with zero eligible
    suppliers. This is a legitimate, clearly-labeled outcome -- not an
    error/exception -- so downstream callers (API layer, UI) can render
    "no supplier currently clears the bar, here's what we tried" instead of
    a failure state.

    Sets `message` to a single plain-English sentence stating exactly that
    (no defensible shortlist, manual review needed) rather than leaving
    callers to translate status="no_shortlist_found" into user-facing copy
    themselves -- and, critically, rather than ever guessing at a shortlist
    or looping past max_iterations to keep trying.
    """
    attempts = state["iteration"]
    return {
        "status": "no_shortlist_found",
        "final_shortlist": [],
        "message": (
            f"No defensible shortlist found after {attempts} relaxation "
            f"attempt{'s' if attempts != 1 else ''} -- manual review needed."
        ),
    }
