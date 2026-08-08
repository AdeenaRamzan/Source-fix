"""
sourcefix.app.main
====================

FastAPI wrapper around the tested LangGraph agent (app/agent/graph.py) and
its deterministic core (app/agent/tools.py). This file adds no new decision
logic of its own -- every endpoint here is a thin adapter over functions
that already have test coverage in tests/test_agent.py and
tests/test_tools.py.

Endpoints:

    POST /api/analyze
        Runs the full agent loop (run_filter -> propose/apply relaxation
        loop -> finalize|give_up) to completion and returns the final
        AgentState as JSON.

    POST /api/analyze/stream
        Same agent, but streams each node's output as a Server-Sent Event
        as soon as it happens, so a frontend can render a live "agent
        thinking" trace instead of waiting for the whole run to finish.

    POST /api/baseline
        Runs ONLY tools.eligibility_filter against the ORIGINAL, unrelaxed
        constraints -- no relaxation loop, no LLM calls, no agent at all.
        This is the non-agent control the brief asks for: with this
        dataset it is expected to return zero eligible suppliers, which is
        exactly the gap the agent's relaxation loop exists to close.

All three endpoints default to the bundled demo dataset
(app/data/suppliers.json + app/data/product_brief.json) when the request
body omits `suppliers` / `constraints`, but accept overrides for testing
with different data.
"""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from .agent.graph import build_graph, run_agent
from .agent.state import make_initial_state
from .agent.tools import eligibility_filter, sensitivity_report
from .data.db import (
    create_supplier_record,
    delete_supplier_record,
    get_supplier_by_id,
    load_suppliers_as_dicts,
    update_supplier_record,
)

load_dotenv(Path(__file__).resolve().parent.parent / ".env")
load_dotenv()

# ---------------------------------------------------------------------------
# Bundled demo dataset
# ---------------------------------------------------------------------------

DATA_DIR = Path(__file__).resolve().parent / "data"


def _load_default_suppliers() -> List[Dict[str, Any]]:
    return load_suppliers_as_dicts()


def _load_default_constraints() -> List[Dict[str, Any]]:
    with open(DATA_DIR / "product_brief.json") as f:
        return json.load(f)["requirements"]


def _parse_reference_date(raw: Optional[str]) -> Optional[date]:
    if raw is None:
        return None
    try:
        return date.fromisoformat(raw)
    except ValueError:
        raise HTTPException(
            status_code=422,
            detail=f"reference_date must be an ISO date string (YYYY-MM-DD), got {raw!r}.",
        )


def _jsonable(obj: Any) -> Any:
    """Recursively convert date/datetime objects to ISO strings so agent
    state (which may carry a `reference_date`) is always JSON-serializable.
    """
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


# ---------------------------------------------------------------------------
# App + CORS
# ---------------------------------------------------------------------------

app = FastAPI(
    title="SourceFix API",
    description="Supplier evaluation and soft-constraint relaxation agent API.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AnalyzeRequest(BaseModel):
    suppliers: Optional[List[Dict[str, Any]]] = None
    constraints: Optional[List[Dict[str, Any]]] = None
    max_iterations: int = 5
    reference_date: Optional[str] = None  # "YYYY-MM-DD"; None = date.today()
    propose_model: str = "llama-3.3-70b-versatile"
    finalize_model: str = "llama-3.3-70b-versatile"


class BaselineRequest(BaseModel):
    suppliers: Optional[List[Dict[str, Any]]] = None
    constraints: Optional[List[Dict[str, Any]]] = None
    reference_date: Optional[str] = None


class SupplierCreate(BaseModel):
    supplier_id: str
    name: str
    certifications: Optional[List[Dict[str, Any]]] = None
    moq: int
    lead_time_days: int
    location_region: str
    capacity_units_month: int
    quality_history_score: float
    sustainability_score: float
    source_row: Optional[int] = None


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    certifications: Optional[List[Dict[str, Any]]] = None
    moq: Optional[int] = None
    lead_time_days: Optional[int] = None
    location_region: Optional[str] = None
    capacity_units_month: Optional[int] = None
    quality_history_score: Optional[float] = None
    sustainability_score: Optional[float] = None
    source_row: Optional[int] = None


# ---------------------------------------------------------------------------
# Health check & Supplier CRUD
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/suppliers")
async def list_suppliers() -> List[Dict[str, Any]]:
    return load_suppliers_as_dicts()


@app.get("/api/suppliers/{supplier_id}")
async def get_supplier(supplier_id: str) -> Dict[str, Any]:
    supplier = get_supplier_by_id(supplier_id)
    if not supplier:
        raise HTTPException(status_code=404, detail=f"Supplier '{supplier_id}' not found.")
    return supplier


@app.post("/api/suppliers", status_code=201)
async def create_supplier(payload: SupplierCreate) -> JSONResponse:
    if get_supplier_by_id(payload.supplier_id):
        raise HTTPException(status_code=409, detail=f"Supplier with ID '{payload.supplier_id}' already exists.")
    try:
        created = create_supplier_record(payload.model_dump())
        return JSONResponse(content=_jsonable(created), status_code=201)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


@app.put("/api/suppliers/{supplier_id}")
async def update_supplier(supplier_id: str, payload: SupplierUpdate) -> Dict[str, Any]:
    if not get_supplier_by_id(supplier_id):
        raise HTTPException(status_code=404, detail=f"Supplier '{supplier_id}' not found.")
    updated = update_supplier_record(supplier_id, payload.model_dump(exclude_unset=True))
    if not updated:
        raise HTTPException(status_code=404, detail=f"Supplier '{supplier_id}' not found.")
    return updated


@app.delete("/api/suppliers/{supplier_id}")
async def delete_supplier(supplier_id: str) -> Dict[str, Any]:
    deleted = delete_supplier_record(supplier_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"Supplier '{supplier_id}' not found.")
    return {"status": "deleted", "supplier_id": supplier_id}


# ---------------------------------------------------------------------------
# POST /api/analyze -- full agent loop, single JSON response
# ---------------------------------------------------------------------------

@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest) -> JSONResponse:
    suppliers = req.suppliers if req.suppliers is not None else _load_default_suppliers()
    constraints = req.constraints if req.constraints is not None else _load_default_constraints()
    reference_date = _parse_reference_date(req.reference_date)

    try:
        # run_agent (graph.py) is synchronous (app.invoke); push it to a
        # worker thread so it doesn't block the event loop while it makes
        # its Groq calls.
        result = await asyncio.to_thread(
            run_agent,
            suppliers=suppliers,
            constraints=constraints,
            max_iterations=req.max_iterations,
            reference_date=reference_date,
            propose_model=req.propose_model,
            finalize_model=req.finalize_model,
        )
    except RuntimeError as exc:
        # nodes.py raises RuntimeError when GROQ_API_KEY is missing --
        # surface that clearly instead of a bare 500 traceback.
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return JSONResponse(content=_jsonable(dict(result)))


# ---------------------------------------------------------------------------
# POST /api/analyze/stream -- same agent, streamed as SSE per node
# ---------------------------------------------------------------------------

@app.post("/api/analyze/stream")
async def analyze_stream(req: AnalyzeRequest) -> StreamingResponse:
    suppliers = req.suppliers if req.suppliers is not None else _load_default_suppliers()
    constraints = req.constraints if req.constraints is not None else _load_default_constraints()
    reference_date = _parse_reference_date(req.reference_date)

    async def event_generator():
        graph = build_graph(
            propose_model=req.propose_model,
            finalize_model=req.finalize_model,
        )
        initial_state = make_initial_state(
            suppliers=suppliers,
            constraints=constraints,
            max_iterations=req.max_iterations,
            reference_date=reference_date,
        )
        # Mirrors graph.run_agent's own recursion_limit sizing.
        recursion_limit = max(50, req.max_iterations * 6 + 10)

        try:
            async for update in graph.astream(
                initial_state,
                config={"recursion_limit": recursion_limit},
                stream_mode="updates",
            ):
                # `update` is {node_name: partial_state_dict} for whichever
                # node just ran -- exactly the "agent thinking" trace step.
                for node_name, node_output in update.items():
                    payload = {"node": node_name, "output": _jsonable(node_output)}
                    yield f"event: node\ndata: {json.dumps(payload)}\n\n"
            yield f"event: done\ndata: {json.dumps({'status': 'complete'})}\n\n"
        except Exception as exc:
            # Surface any mid-run failure (e.g. missing API key hit on the
            # first propose/finalize call) as a terminal SSE event instead
            # of silently dropping the connection.
            payload = {"error": str(exc)}
            yield f"event: error\ndata: {json.dumps(payload)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # disable nginx buffering, if fronted by it
        },
    )


# ---------------------------------------------------------------------------
# POST /api/baseline -- non-agent control: eligibility_filter only
# ---------------------------------------------------------------------------

@app.post("/api/baseline")
async def baseline(req: BaselineRequest) -> JSONResponse:
    """Run ONLY tools.eligibility_filter against the ORIGINAL, unrelaxed
    constraints. No relaxation loop, no LLM calls -- this is the "what
    would a plain rules-only filter return, with no agent at all" control
    the brief asks the demo to compare the agent against.
    """
    suppliers = req.suppliers if req.suppliers is not None else _load_default_suppliers()
    constraints = req.constraints if req.constraints is not None else _load_default_constraints()
    reference_date = _parse_reference_date(req.reference_date)

    result = eligibility_filter(suppliers, constraints, reference_date=reference_date)

    sensitivity: Dict[str, Any] = {}
    soft_constraints = [c for c in constraints if c.get("constraint_type") == "soft"]
    for c in soft_constraints:
        field = c["field"]
        current_val = c.get("acceptable_values", c.get("value"))
        if field == "sustainability_score" and isinstance(current_val, (int, float)):
            new_val = max(0, current_val - 10)
        elif field == "moq_units" and isinstance(current_val, (int, float)):
            new_val = current_val + 2000
        elif field == "lead_time_days" and isinstance(current_val, (int, float)):
            new_val = current_val + 15
        elif field == "region" and isinstance(current_val, list):
            new_val = current_val + ["South America"]
        else:
            new_val = current_val

        try:
            report = sensitivity_report(suppliers, constraints, field, new_val, reference_date=reference_date)
            sensitivity[field] = {
                "field": field,
                "current_value": current_val,
                "hypothetical_value": new_val,
                "newly_eligible_count": len(report["newly_eligible"]),
                "newly_eligible": report["newly_eligible"],
            }
        except Exception:
            pass

    result["sensitivity"] = sensitivity
    return JSONResponse(content=_jsonable(result))
