"""
sourcefix.agent.graph
======================

Wires the nodes in nodes.py into a LangGraph StateGraph:

    START -> run_filter -> [decide_next] -+-> finalize -> END
                                           +-> give_up  -> END
                                           +-> propose_relaxation
                                                  -> apply_relaxation
                                                  -> run_filter   (loop)

Only two edges out of run_filter are "real" edges (propose_relaxation ->
apply_relaxation -> run_filter, forming the negotiation loop); finalize and
give_up are both terminal.

Model choice for the two LLM-calling nodes:

    propose_relaxation_node -> Groq (llama-3.3-70b-versatile by default; use
        openai/gpt-oss-20b instead via the `propose_model` argument if
        that's what's available on your Groq key). This node runs once per
        relaxation attempt -- potentially several times per session -- and
        its output is fully re-validated in code by apply_relaxation_node
        regardless of what it says, so a fast/cheap model is the right
        tradeoff.

    rank_and_finalize_node -> Groq (llama-3.3-70b-versatile by default).
        This node runs exactly once per session and produces the one piece
        of LLM-written text a judge or buyer will actually read and
        scrutinize for unsupported claims, so it uses the largest/most
        capable model available on the Groq key.
"""

from __future__ import annotations

from functools import partial
from typing import Any, Dict, List, Optional

from datetime import date

from langgraph.graph import END, START, StateGraph

from .nodes import (
    LLMCallFn,
    _default_groq_finalize_call,
    _default_groq_call,
    apply_relaxation_node,
    decide_next,
    give_up_node,
    propose_relaxation_node,
    rank_and_finalize_node,
    run_filter_node,
)
from .state import AgentState, make_initial_state


def build_graph(
    propose_llm_call: Optional[LLMCallFn] = None,
    finalize_llm_call: Optional[LLMCallFn] = None,
    propose_model: str = "llama-3.3-70b-versatile",
    finalize_model: str = "llama-3.3-70b-versatile",
):
    """Build and compile the SourceFix agent graph.

    propose_llm_call / finalize_llm_call: inject a fake/stub callable for
        testing (see tests/test_agent.py) or a custom real callable for
        production. When left as None, production defaults are used:
        Groq for propose (see `propose_model`), Groq for finalize (see
        `finalize_model`).
    """
    propose_call = propose_llm_call or partial(_default_groq_call, model=propose_model)
    finalize_call = finalize_llm_call or partial(_default_groq_finalize_call, model=finalize_model)

    graph = StateGraph(AgentState)

    graph.add_node("run_filter", run_filter_node)
    graph.add_node("propose_relaxation", partial(propose_relaxation_node, llm_call=propose_call))
    graph.add_node("apply_relaxation", apply_relaxation_node)
    graph.add_node("finalize", partial(rank_and_finalize_node, llm_call=finalize_call))
    graph.add_node("give_up", give_up_node)

    graph.add_edge(START, "run_filter")
    graph.add_conditional_edges(
        "run_filter",
        decide_next,
        {
            "finalize": "finalize",
            "propose_relaxation": "propose_relaxation",
            "give_up": "give_up",
        },
    )
    graph.add_edge("propose_relaxation", "apply_relaxation")
    graph.add_edge("apply_relaxation", "run_filter")
    graph.add_edge("finalize", END)
    graph.add_edge("give_up", END)

    return graph.compile()


def run_agent(
    suppliers: List[Dict[str, Any]],
    constraints: List[Dict[str, Any]],
    max_iterations: int = 5,
    reference_date: Optional[date] = None,
    propose_llm_call: Optional[LLMCallFn] = None,
    finalize_llm_call: Optional[LLMCallFn] = None,
    propose_model: str = "llama-3.3-70b-versatile",
    finalize_model: str = "llama-3.3-70b-versatile",
) -> AgentState:
    """Convenience entry point: build the graph, seed initial state, run it
    to completion, and return the final AgentState.

    Kept separate from build_graph so callers who want the compiled graph
    itself (e.g. to stream intermediate steps) can still get it.
    """
    app = build_graph(
        propose_llm_call=propose_llm_call,
        finalize_llm_call=finalize_llm_call,
        propose_model=propose_model,
        finalize_model=finalize_model,
    )
    initial_state = make_initial_state(
        suppliers=suppliers,
        constraints=constraints,
        max_iterations=max_iterations,
        reference_date=reference_date,
    )
    # LangGraph's default recursion_limit (25 "supersteps") can be too tight
    # for a legitimate run: each relaxation attempt costs 3 steps
    # (propose -> apply -> run_filter), plus the initial run_filter and the
    # terminal finalize/give_up step. Size it generously off max_iterations
    # rather than risk a correct, in-progress run getting cut off.
    recursion_limit = max(50, max_iterations * 6 + 10)
    result = app.invoke(initial_state, config={"recursion_limit": recursion_limit})
    return result
