"""
Tests for the deterministic core in app/agent/tools.py.

No LLM calls, no network calls, no wall-clock dependence -- every date-
sensitive check is pinned to an explicit reference_date so these tests are
reproducible regardless of when they're run.
"""

import json
from datetime import date
from pathlib import Path

import pytest

from app.agent.tools import (
    check_constraint,
    cite_lookup,
    count_failures_by_field,
    eligibility_filter,
    sensitivity_report,
)

DATA_DIR = Path(__file__).resolve().parent.parent / "app" / "data"

# The dataset was authored against "today" being 2026-08-08 (see
# source_manifest.md / challenge pack generation). Pinning this explicitly
# keeps certification expiry checks deterministic no matter when the suite
# actually runs.
REFERENCE_DATE = date(2026, 8, 8)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope="module")
def brief():
    with open(DATA_DIR / "product_brief.json") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def constraints(brief):
    return brief["requirements"]


@pytest.fixture(scope="module")
def suppliers():
    with open(DATA_DIR / "suppliers.json") as f:
        return json.load(f)["suppliers"]


def _supplier(suppliers, source_id):
    return next(s for s in suppliers if s["source_id"] == source_id)


def _constraint(constraints, field):
    return next(c for c in constraints if c["field"] == field)


# ---------------------------------------------------------------------------
# check_constraint: a hard constraint correctly fails
# ---------------------------------------------------------------------------

def test_hard_capacity_constraint_correctly_fails(suppliers, constraints):
    # SUP-005 (Highland Injection Works) quotes 18,000 units/month against a
    # hard minimum of 20,000 -- must fail, and the reason must cite the
    # actual number so the failure is auditable.
    supplier = _supplier(suppliers, "SUP-005")
    constraint = _constraint(constraints, "monthly_capacity_units")

    assert constraint["constraint_type"] == "hard"

    passed, reason = check_constraint(supplier, constraint, reference_date=REFERENCE_DATE)

    assert passed is False
    assert "18000" in reason
    assert "20000" in reason


def test_hard_quality_history_constraint_correctly_fails(suppliers, constraints):
    # SUP-006 (Delta Plastics Group) scores 80 against a hard minimum of 85.
    supplier = _supplier(suppliers, "SUP-006")
    constraint = _constraint(constraints, "quality_history_score")

    assert constraint["constraint_type"] == "hard"

    passed, reason = check_constraint(supplier, constraint, reference_date=REFERENCE_DATE)

    assert passed is False
    assert "80" in reason


# ---------------------------------------------------------------------------
# check_constraint: expired / ambiguous certification never counts as valid
# ---------------------------------------------------------------------------

def test_cleanly_expired_certification_does_not_count_as_valid(suppliers, constraints):
    # SUP-007 (Redwood Components): status says 'expired' AND the expiry
    # date (2024-05-01) is in the past -- both signals agree it's expired.
    supplier = _supplier(suppliers, "SUP-007")
    constraint = _constraint(constraints, "certification")

    passed, reason = check_constraint(supplier, constraint, reference_date=REFERENCE_DATE)

    assert passed is False
    assert "not valid" in reason.lower()


def test_ambiguous_conflicting_certification_fails_closed(suppliers, constraints):
    # SUP-008 (Meridian Tooling Ltd.): status field says 'expired' but the
    # expiry_date (2027-01-01) is still in the future -- the source record
    # is internally inconsistent. This must NOT be treated as a pass; it
    # must fail closed and say why, rather than guessing.
    supplier = _supplier(suppliers, "SUP-008")
    constraint = _constraint(constraints, "certification")

    passed, reason = check_constraint(supplier, constraint, reference_date=REFERENCE_DATE)

    assert passed is False
    assert "AMBIGUOUS" in reason
    assert "expired" in reason  # cites the conflicting status value
    assert "2027-01-01" in reason  # cites the conflicting expiry date


def test_missing_certification_field_fails_closed(suppliers, constraints):
    # A supplier record with no certification block at all must fail
    # closed, not be skipped or default to "pass".
    supplier_missing_cert = {"source_id": "SUP-TEST-MISSING", "source_row": 999}
    constraint = _constraint(constraints, "certification")

    passed, reason = check_constraint(supplier_missing_cert, constraint, reference_date=REFERENCE_DATE)

    assert passed is False
    assert "missing" in reason.lower()


# ---------------------------------------------------------------------------
# eligibility_filter: full constraint set against the generated pack
# ---------------------------------------------------------------------------

def test_full_constraint_set_returns_zero_eligible_suppliers(suppliers, constraints):
    result = eligibility_filter(suppliers, constraints, reference_date=REFERENCE_DATE)

    assert result["eligible"] == [], (
        "The synthetic challenge pack is specifically designed so that zero "
        "suppliers are fully eligible today -- if this fails, the dataset "
        "or the filter logic has drifted from that baseline."
    )
    # Sanity: we actually evaluated every supplier, not an empty list.
    assert len(result["results"]) == len(suppliers) == 13


def test_eligibility_filter_breakdown_covers_every_field_per_supplier(suppliers, constraints):
    result = eligibility_filter(suppliers, constraints, reference_date=REFERENCE_DATE)
    expected_fields = {c["field"] for c in constraints}

    for supplier_id, field_results in result["results"].items():
        assert set(field_results.keys()) == expected_fields
        for field, info in field_results.items():
            assert isinstance(info["passed"], bool)
            assert isinstance(info["reason"], str) and info["reason"]
            assert info["constraint_type"] in ("hard", "soft")


# ---------------------------------------------------------------------------
# count_failures_by_field
# ---------------------------------------------------------------------------

def test_count_failures_by_field_matches_manual_tally(suppliers, constraints):
    result = eligibility_filter(suppliers, constraints, reference_date=REFERENCE_DATE)
    counts = count_failures_by_field(result)

    # Manual tally as a cross-check.
    manual = {c["field"]: 0 for c in constraints}
    for field_results in result["results"].values():
        for field, info in field_results.items():
            if not info["passed"]:
                manual[field] += 1

    assert counts == {k: v for k, v in manual.items() if v > 0} or counts == manual
    # every count must be <= total supplier count and > 0 somewhere
    assert all(0 < v <= len(suppliers) for v in counts.values())


# ---------------------------------------------------------------------------
# cite_lookup
# ---------------------------------------------------------------------------

def test_cite_lookup_returns_exact_value_and_source_row(suppliers):
    citation = cite_lookup(suppliers, "SUP-005", "monthly_capacity_units")

    assert citation["value"] == 18000
    assert citation["source_row"] == 5
    assert citation["supplier_id"] == "SUP-005"


def test_cite_lookup_supports_nested_fields(suppliers):
    citation = cite_lookup(suppliers, "SUP-008", "certification.status")

    assert citation["value"] == "expired"
    assert citation["source_row"] == 8


def test_cite_lookup_raises_for_unknown_supplier(suppliers):
    with pytest.raises(KeyError):
        cite_lookup(suppliers, "SUP-DOES-NOT-EXIST", "moq_units")


def test_cite_lookup_raises_for_missing_field(suppliers):
    # SUP-009 is missing sustainability_score entirely.
    with pytest.raises(KeyError):
        cite_lookup(suppliers, "SUP-009", "sustainability_score")


# ---------------------------------------------------------------------------
# sensitivity_report: relaxing one soft constraint produces >= 1 eligible
# ---------------------------------------------------------------------------

def test_relaxing_the_highest_failing_soft_constraint_yields_eligible_supplier(suppliers, constraints):
    baseline = eligibility_filter(suppliers, constraints, reference_date=REFERENCE_DATE)
    assert baseline["eligible"] == []  # confirms we're starting from the zero baseline

    fail_counts = count_failures_by_field(baseline)
    soft_fields = {c["field"] for c in constraints if c["constraint_type"] == "soft"}

    # Identify which soft constraint is blocking the most suppliers -- this
    # is the one worth relaxing first in a negotiation conversation.
    target_field = max(soft_fields, key=lambda f: fail_counts.get(f, 0))

    # Given the pack as generated, sustainability_score is the soft
    # constraint with the most failures (5 of 13 suppliers).
    assert target_field == "sustainability_score"
    assert fail_counts[target_field] == max(fail_counts.get(f, 0) for f in soft_fields)

    target_constraint = _constraint(constraints, target_field)
    original_threshold = target_constraint["value"]
    relaxed_threshold = original_threshold - 10  # meaningfully relax the minimum

    report = sensitivity_report(
        suppliers, constraints, target_field, relaxed_threshold, reference_date=REFERENCE_DATE
    )

    assert report["baseline_eligible"] == []
    assert len(report["hypothetical_eligible"]) >= 1
    assert len(report["newly_eligible"]) >= 1

    # The original constraint list passed in must be untouched -- this is a
    # hypothetical report, not a commitment.
    assert _constraint(constraints, target_field)["value"] == original_threshold


def test_sensitivity_report_relaxing_region_also_rescues_a_supplier(suppliers, constraints):
    # A second, independent soft constraint: widening the acceptable region
    # list to include South America should rescue SUP-004 (Andes
    # Manufacturing SA), which otherwise passes every other requirement.
    report = sensitivity_report(
        suppliers,
        constraints,
        "region",
        ["North America", "Western Europe", "Southeast Asia", "South America"],
        reference_date=REFERENCE_DATE,
    )

    assert "SUP-004" in report["newly_eligible"]
    assert len(report["hypothetical_eligible"]) >= 1

    # Original constraints untouched.
    original_region_constraint = _constraint(constraints, "region")
    assert "South America" not in original_region_constraint["acceptable_values"]


def test_sensitivity_report_does_not_mutate_input_constraints(suppliers, constraints):
    before = json.dumps(constraints, sort_keys=True)
    sensitivity_report(suppliers, constraints, "moq_units", 100000, reference_date=REFERENCE_DATE)
    after = json.dumps(constraints, sort_keys=True)

    assert before == after
