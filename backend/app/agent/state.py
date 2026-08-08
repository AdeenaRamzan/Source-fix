"""
sourcefix.agent.state
======================

The shared state object threaded through every node in the LangGraph agent
loop (see graph.py). Kept as a plain TypedDict -- no behavior lives here,
only shape -- so every node's contract is legible just from this file.

Field-by-field:

    suppliers
        The full supplier list (from suppliers.json). Never mutated.

    original_constraints
        The product brief's requirements, exactly as given, before any
        relaxation. Kept around unmodified as the "what did the buyer
        actually ask for" record, even after working_constraints has been
        loosened -- this is what the final shortlist explanation and any
        audit trail should be able to diff against.

    working_constraints
        The constraint list actually used by eligibility_filter on each
        pass. Starts as a deep copy of original_constraints and is replaced
        (never mutated in place) by apply_relaxation_node whenever a
        relaxation is accepted.

    filter_result
        The most recent return value of tools.eligibility_filter: a dict
        with "results" (per-supplier/per-field pass/fail + reason) and
        "eligible" (list of supplier_ids that passed everything). None
        before the first run_filter pass.

    relaxation_ledger
        Append-only audit log. One entry per apply_relaxation_node call,
        whether the proposal was accepted or rejected. This is the record
        a human or a judge would read to answer "what did the agent try,
        and what did it actually change?" -- so rejections are logged here
        too, not just successes.

    visited_relaxations
        Just the (field, new_value) pairs that have actually been APPLIED
        so far this run. Passed back into propose_relaxation_node's prompt
        so the LLM doesn't keep re-proposing a relaxation that already
        happened and evidently wasn't enough on its own.

    iteration
        How many times apply_relaxation_node has run (accepted or
        rejected -- rejections still cost an iteration). This is the
        counter decide_next compares against max_iterations, which is what
        guarantees the loop terminates even if the LLM never proposes
        anything useful.

    max_iterations
        Hard ceiling on relaxation attempts before the agent gives up.

    status
        "running" while the graph is still working, "shortlisted" once
        rank_and_finalize_node has produced a final_shortlist, or
        "no_shortlist_found" if give_up_node was reached. This is a
        legitimate terminal outcome, not an error state.

    final_shortlist
        None until the run terminates. On success: a ranked list of
        {"supplier_id", "explanation"} dicts. On give-up: an empty list.

    message
        None while running. A single human-readable sentence set exactly
        once, by whichever terminal node ends the run:
        rank_and_finalize_node on success, give_up_node on give-up. Exists
        so API/UI callers have one plain-English string to surface
        directly (e.g. "No defensible shortlist found after 5 relaxation
        attempt(s) -- manual review needed.") without having to re-derive
        that phrasing from status/iteration themselves.

Two extra bookkeeping fields are included beyond the ones enumerated above,
because the graph needs somewhere to pass data between propose_relaxation
and apply_relaxation, and needs a pinnable notion of "today" for
deterministic testing (mirrors REFERENCE_DATE in test_tools.py):

    pending_relaxation
        The raw (parsed) proposal dict from propose_relaxation_node,
        consumed and cleared by apply_relaxation_node on the very next
        step. None the rest of the time.

    reference_date
        Optional[date] forwarded into eligibility_filter so tests can pin
        "today" instead of depending on wall-clock time. None means
        "use date.today()", exactly like tools.eligibility_filter's own
        default.
"""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Optional, TypedDict

Status = str  # "running" | "shortlisted" | "no_shortlist_found"


class AgentState(TypedDict):
    suppliers: List[Dict[str, Any]]
    original_constraints: List[Dict[str, Any]]
    working_constraints: List[Dict[str, Any]]
    filter_result: Optional[Dict[str, Any]]
    relaxation_ledger: List[Dict[str, Any]]
    visited_relaxations: List[Dict[str, Any]]
    iteration: int
    max_iterations: int
    status: Status
    final_shortlist: Optional[List[Dict[str, Any]]]
    message: Optional[str]

    # Internal plumbing -- see module docstring.
    pending_relaxation: Optional[Dict[str, Any]]
    reference_date: Optional[date]


def make_initial_state(
    suppliers: List[Dict[str, Any]],
    constraints: List[Dict[str, Any]],
    max_iterations: int = 5,
    reference_date: Optional[date] = None,
) -> AgentState:
    """Convenience constructor so callers (graph.run_agent, tests) never
    hand-roll the initial dict and risk drifting from this schema."""
    import copy

    return AgentState(
        suppliers=suppliers,
        original_constraints=copy.deepcopy(constraints),
        working_constraints=copy.deepcopy(constraints),
        filter_result=None,
        relaxation_ledger=[],
        visited_relaxations=[],
        iteration=0,
        max_iterations=max_iterations,
        status="running",
        final_shortlist=None,
        message=None,
        pending_relaxation=None,
        reference_date=reference_date,
    )
