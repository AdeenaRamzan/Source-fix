"""
sourcefix.agent.tools
======================

Deterministic core of SourceFix. Every function here is pure, synchronous
Python: no network calls, no LLM calls, no randomness, no wall-clock
dependence unless a reference date is explicitly passed in. This module is
the "ground truth" the rest of the system (including any future AI layer)
is built on top of, so it is intentionally boring, explicit, and fully
unit-testable.

Data shapes assumed (see app/data/data_dictionary.md for the full spec):

    constraint = {
        "field": "monthly_capacity_units",
        "operator": ">=",          # numeric constraints
        "value": 20000,            # numeric constraints
        # OR
        "acceptable_values": [...] # categorical constraints (e.g. region)
        "constraint_type": "hard" | "soft",
        ...
    }

    supplier = {
        "source_id": "SUP-001",
        "source_row": 1,
        "certification": {"type": ..., "status": ..., "expiry_date": "YYYY-MM-DD"},
        "monthly_capacity_units": 25000,
        ...
    }
"""

from __future__ import annotations

import copy
import operator as _operator
from collections import defaultdict
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Fallback list of certification types considered acceptable if a constraint
# does not explicitly specify its own `acceptable_cert_types`.
DEFAULT_ACCEPTED_CERT_TYPES = ("ISO9001", "IATF16949")

_OPERATORS = {
    ">=": _operator.ge,
    "<=": _operator.le,
    ">": _operator.gt,
    "<": _operator.lt,
    "==": _operator.eq,
    "!=": _operator.ne,
}

_MISSING = object()  # sentinel for "field not present at all"


# ---------------------------------------------------------------------------
# Small internal helpers
# ---------------------------------------------------------------------------

def _get_nested(d: Dict[str, Any], dotted_path: str) -> Any:
    """Look up a possibly-nested field via dot notation, e.g. 'certification.status'.

    Returns the sentinel _MISSING (not None, not KeyError) if any part of the
    path is absent, so callers can distinguish "missing data" from "value is
    legitimately None/0/empty".
    """
    current: Any = d
    for part in dotted_path.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return _MISSING
    return current


def _parse_date(value: str) -> Optional[date]:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _supplier_label(supplier: Dict[str, Any]) -> str:
    sid = supplier.get("source_id", "UNKNOWN")
    name = supplier.get("supplier_name")
    return f"{sid} ({name})" if name else sid


# ---------------------------------------------------------------------------
# check_constraint
# ---------------------------------------------------------------------------

def check_constraint(
    supplier: Dict[str, Any],
    constraint: Dict[str, Any],
    reference_date: Optional[date] = None,
) -> Tuple[bool, str]:
    """Evaluate a single constraint against a single supplier.

    Returns (passed, reason). `reason` is always a plain-English, citable
    explanation referencing the actual field/value involved -- never just
    "pass" or "fail" with no context.

    Missing data and internally-conflicting certification records are never
    silently treated as a pass. They fail closed, with a reason that says why.
    """
    supplier = normalize_supplier(supplier)
    field = constraint["field"]
    ref_date = reference_date or date.today()

    # --- Special-cased field: certification -------------------------------
    if field == "certification":
        cert = supplier.get("certification")
        if not isinstance(cert, dict):
            return False, f"{_supplier_label(supplier)}: 'certification' field is missing entirely."

        cert_type = cert.get("type")
        status = cert.get("status")
        expiry_raw = cert.get("expiry_date")
        accepted_types = constraint.get("acceptable_cert_types", DEFAULT_ACCEPTED_CERT_TYPES)

        expiry_date = _parse_date(expiry_raw) if expiry_raw else None
        if expiry_date is None:
            return (
                False,
                f"{_supplier_label(supplier)}: certification expiry_date "
                f"('{expiry_raw}') is missing or unparseable; cannot verify validity.",
            )

        status_says_valid = status == "valid"
        date_says_valid = expiry_date >= ref_date

        if status_says_valid != date_says_valid:
            return (
                False,
                f"{_supplier_label(supplier)}: AMBIGUOUS certification record -- "
                f"status field says '{status}' but expiry_date {expiry_raw} "
                f"{'is still in the future' if date_says_valid else 'is already in the past'} "
                f"as of {ref_date.isoformat()}. Conflicting source data; does not count as a "
                f"valid certification until verified.",
            )

        if cert_type not in accepted_types:
            return (
                False,
                f"{_supplier_label(supplier)}: certification type '{cert_type}' is not "
                f"one of the accepted types {tuple(accepted_types)}.",
            )

        if not status_says_valid:
            return (
                False,
                f"{_supplier_label(supplier)}: certification status is '{status}' "
                f"(expiry_date {expiry_raw}), not valid.",
            )

        return (
            True,
            f"{_supplier_label(supplier)}: certification {cert_type} is valid "
            f"through {expiry_raw}.",
        )

    # --- Generic fields -----------------------------------------------------
    value = _get_nested(supplier, field)
    if value is _MISSING:
        return (
            False,
            f"{_supplier_label(supplier)}: field '{field}' is missing from this "
            f"supplier record; cannot verify against the requirement.",
        )

    # Categorical constraint (e.g. region)
    if "acceptable_values" in constraint:
        acceptable = constraint["acceptable_values"]
        passed = value in acceptable
        reason = (
            f"{_supplier_label(supplier)}: {field}='{value}' is "
            f"{'in' if passed else 'NOT in'} the acceptable set {acceptable}."
        )
        return passed, reason

    # Numeric/comparison constraint
    if "operator" in constraint and "value" in constraint:
        op_symbol = constraint["operator"]
        threshold = constraint["value"]
        op_func = _OPERATORS.get(op_symbol)
        if op_func is None:
            raise ValueError(f"Unsupported operator '{op_symbol}' in constraint for field '{field}'.")
        passed = op_func(value, threshold)
        reason = (
            f"{_supplier_label(supplier)}: {field}={value} "
            f"{'satisfies' if passed else 'fails'} requirement ({op_symbol} {threshold})."
        )
        return passed, reason

    raise ValueError(
        f"Malformed constraint for field '{field}': must define either "
        f"'acceptable_values' or both 'operator' and 'value'."
    )


# ---------------------------------------------------------------------------
# eligibility_filter
# ---------------------------------------------------------------------------

def normalize_supplier(supplier: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure any supplier format (e.g. source_id vs supplier_id, name vs supplier_name,
    capacity_units_month vs monthly_capacity_units, moq vs moq_units, location_region vs region,
    certifications array vs certification object) maps to standard schema.
    """
    n = dict(supplier)
    if "source_id" not in n and "supplier_id" in n:
        n["source_id"] = n["supplier_id"]
    if "supplier_name" not in n and "name" in n:
        n["supplier_name"] = n["name"]
    if "monthly_capacity_units" not in n and "capacity_units_month" in n:
        n["monthly_capacity_units"] = n["capacity_units_month"]
    if "moq_units" not in n and "moq" in n:
        n["moq_units"] = n["moq"]
    if "region" not in n and "location_region" in n:
        n["region"] = n["location_region"]
    if "certification" not in n and "certifications" in n:
        c = n["certifications"]
        if isinstance(c, list) and len(c) > 0:
            first = c[0]
            n["certification"] = {
                "type": first.get("name", first.get("type", "ISO9001")),
                "status": first.get("status", "valid"),
                "expiry_date": first.get("expires", first.get("expiry_date", "2027-12-31")),
            }
    return n


def eligibility_filter(
    suppliers: List[Dict[str, Any]],
    constraints: List[Dict[str, Any]],
    reference_date: Optional[date] = None,
) -> Dict[str, Any]:
    """Run every constraint against every supplier.

    Returns:
        {
            "results": {
                supplier_id: {
                    field: {"passed": bool, "reason": str, "constraint_type": "hard"|"soft"},
                    ...
                },
                ...
            },
            "eligible": [supplier_id, ...],   # suppliers that passed EVERY constraint
        }

    A supplier is only "eligible" if it passes all constraints supplied,
    hard and soft alike -- callers who want a "hard-only" view can filter
    constraints before calling this, or filter on constraint_type in results.
    """
    results: Dict[str, Dict[str, Dict[str, Any]]] = {}
    eligible: List[str] = []

    for raw_supplier in suppliers:
        supplier = normalize_supplier(raw_supplier)
        sid = supplier.get("source_id", _supplier_label(supplier))
        field_results: Dict[str, Dict[str, Any]] = {}
        all_passed = True

        for constraint in constraints:
            field = constraint["field"]
            passed, reason = check_constraint(supplier, constraint, reference_date=reference_date)
            field_results[field] = {
                "passed": passed,
                "reason": reason,
                "constraint_type": constraint.get("constraint_type"),
            }
            if not passed:
                all_passed = False

        results[sid] = field_results
        if all_passed:
            eligible.append(sid)

    return {"results": results, "eligible": eligible}


# ---------------------------------------------------------------------------
# count_failures_by_field
# ---------------------------------------------------------------------------

def count_failures_by_field(all_results: Dict[str, Any]) -> Dict[str, int]:
    """Tally how many suppliers failed each field.

    Accepts either the full dict returned by eligibility_filter (with
    "results"/"eligible" keys) or just the inner "results" mapping directly.
    """
    if isinstance(all_results, dict) and "results" in all_results and "eligible" in all_results:
        results = all_results["results"]
    else:
        results = all_results

    counts: Dict[str, int] = defaultdict(int)
    for _supplier_id, field_results in results.items():
        for field, info in field_results.items():
            if not info["passed"]:
                counts[field] += 1

    return dict(counts)


# ---------------------------------------------------------------------------
# cite_lookup
# ---------------------------------------------------------------------------

def cite_lookup(
    suppliers: List[Dict[str, Any]],
    supplier_id: str,
    field: str,
) -> Dict[str, Any]:
    """Return the exact source value for `field` on `supplier_id`, plus enough
    metadata (source_row, supplier_name) to cite it back to the raw dataset.

    `field` supports dot notation for nested values, e.g. 'certification.status'.

    Raises:
        KeyError: if the supplier_id doesn't exist, or the field is absent
                   from that supplier's record.
    """
    raw_supplier = next((s for s in suppliers if s.get("source_id") == supplier_id or s.get("supplier_id") == supplier_id), None)
    if raw_supplier is None:
        raise KeyError(f"No supplier found with source_id '{supplier_id}'.")

    supplier = normalize_supplier(raw_supplier)

    value = _get_nested(supplier, field)
    if value is _MISSING:
        raise KeyError(f"Field '{field}' is not present on supplier '{supplier_id}'.")

    return {
        "supplier_id": supplier_id,
        "supplier_name": supplier.get("supplier_name"),
        "source_row": supplier.get("source_row"),
        "field": field,
        "value": value,
    }


# ---------------------------------------------------------------------------
# sensitivity_report
# ---------------------------------------------------------------------------

def sensitivity_report(
    suppliers: List[Dict[str, Any]],
    constraints: List[Dict[str, Any]],
    field: str,
    new_value: Any,
    reference_date: Optional[date] = None,
) -> Dict[str, Any]:
    """Ask "what if we relaxed this one constraint?" without committing to it.

    Reruns eligibility_filter with a single hypothetical override applied to
    a deep copy of `constraints`; the caller's original constraint list is
    never mutated.

    `new_value`:
        - a list/tuple  -> replaces `acceptable_values` for categorical
                            constraints (e.g. region).
        - anything else -> replaces `value` for numeric/comparison
                            constraints (the `operator` is kept as-is).

    Returns:
        {
            "field": field,
            "new_value": new_value,
            "baseline_eligible": [...],       # eligible suppliers under the ORIGINAL constraints
            "hypothetical_eligible": [...],   # eligible suppliers under the MODIFIED constraint
            "newly_eligible": [...],          # suppliers eligible only after the change
            "hypothetical_results": {...},    # full per-supplier/per-field breakdown under the change
        }
    """
    baseline = eligibility_filter(suppliers, constraints, reference_date=reference_date)

    hypothetical_constraints = copy.deepcopy(constraints)
    target = next((c for c in hypothetical_constraints if c["field"] == field), None)
    if target is None:
        raise ValueError(f"No constraint found for field '{field}'.")

    if isinstance(new_value, (list, tuple)):
        target["acceptable_values"] = list(new_value)
    else:
        if "value" not in target:
            raise ValueError(
                f"Constraint for field '{field}' is categorical (acceptable_values); "
                f"pass a list/tuple as new_value to relax it, not a scalar."
            )
        target["value"] = new_value

    hypothetical = eligibility_filter(suppliers, hypothetical_constraints, reference_date=reference_date)

    baseline_set = set(baseline["eligible"])
    hypothetical_set = set(hypothetical["eligible"])

    return {
        "field": field,
        "new_value": new_value,
        "baseline_eligible": sorted(baseline_set),
        "hypothetical_eligible": sorted(hypothetical_set),
        "newly_eligible": sorted(hypothetical_set - baseline_set),
        "hypothetical_results": hypothetical["results"],
    }
