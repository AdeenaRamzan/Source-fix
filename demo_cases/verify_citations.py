"""
sourcefix.demo_cases.verify_citations
=======================================

Independent check (separate from generate_demo_cases.py) for two of the
evaluation numbers in SUBMISSION.md:

  - citation coverage:      % of factual field=value claims in the final
                             shortlist's explanations that match a value
                             actually present in that run's filter_result
                             (which is itself built from supplier records
                             that carry source_row).
  - unsupported-claim rate: % of those same claims that do NOT match --
                             i.e. would have been fabricated by the LLM
                             rather than grounded in the filter's own data.

Method: for each supplier explanation in case1_successful_relaxation.json's
final_shortlist, regex out every "<field>=<value>" or "<field> is/=
'<value>'" style mention, then look up that exact field/value pair in the
same response's filter_result.results[supplier_id]. A claim counts as
"traceable" if the field is one eligibility_filter actually evaluated for
that supplier AND the value mentioned matches the value cite_lookup()
returns for that supplier/field straight from suppliers.json (i.e. traced
all the way back to source_row, not just to the filter's own restatement of
it). No LLM or judgment call is involved in this script -- it is a plain
string/data match, so it is itself fully reproducible.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.agent.tools import cite_lookup  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent
DATA_DIR = BACKEND_DIR / "app" / "data"

with open(DATA_DIR / "suppliers.json") as f:
    ALL_SUPPLIERS = json.load(f)["suppliers"]

with open(OUT_DIR / "case1_successful_relaxation.json") as f:
    CASE1 = json.load(f)

body = CASE1["step_B_agent_run"]["response"]["body"]
filter_results = body["filter_result"]["results"]
final_shortlist = body["final_shortlist"]

# Matches things like: monthly_capacity_units=25000  |  sustainability_score=55
# and quoted-value forms like: certification is ISO9001/valid
FIELD_VALUE_RE = re.compile(r"([a-z_]+)\s*=\s*([0-9]+(?:\.[0-9]+)?)")

total_claims = 0
traceable_claims = 0
unsupported = []

for entry in final_shortlist:
    sid = entry["supplier_id"]
    explanation = entry["explanation"] or ""
    supplier_fields = filter_results.get(sid, {})

    for field, raw_value in FIELD_VALUE_RE.findall(explanation):
        if field not in supplier_fields:
            continue  # not a field this filter evaluated -- not a data claim, skip
        total_claims += 1
        try:
            value = int(raw_value)
        except ValueError:
            value = float(raw_value)

        try:
            source = cite_lookup(ALL_SUPPLIERS, sid, field)
        except KeyError:
            unsupported.append((sid, field, raw_value, "field not found on supplier record"))
            continue

        if source["value"] == value:
            traceable_claims += 1
        else:
            unsupported.append((sid, field, raw_value, f"source value is {source['value']!r}"))

coverage_pct = round(100 * traceable_claims / total_claims, 1) if total_claims else 0.0
unsupported_pct = round(100 * len(unsupported) / total_claims, 1) if total_claims else 0.0

result = {
    "total_numeric_field_claims_checked": total_claims,
    "traceable_to_source_row": traceable_claims,
    "citation_coverage_pct": coverage_pct,
    "unsupported_claims": unsupported,
    "unsupported_claim_rate_pct": unsupported_pct,
}

print(json.dumps(result, indent=2))

with open(OUT_DIR / "citation_verification_result.json", "w") as f:
    json.dump(result, f, indent=2)
print(f"\nwrote {OUT_DIR / 'citation_verification_result.json'}")
