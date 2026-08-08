# SourceFix Data Dictionary

This document defines every field in `product_brief.json` and `suppliers.json`,
including valid values/ranges and whether each requirement is **hard**
(non-negotiable, disqualifying) or **soft** (commercially negotiable, can be
waived or worked around).

---

## 1. product_brief.json

| Field | Type | Meaning | Valid values / range |
|---|---|---|---|
| `product_id` | string | Internal identifier for the product being sourced. | Free-text ID, unique. |
| `product_name` | string | Human-readable product name. | Free text. |
| `description` | string | Technical description of the part, used for context (not scored). | Free text. |
| `target_annual_volume_units` | integer | Expected annual demand, for context when judging capacity fit. | Positive integer. |
| `sourcing_event` | string | Which hackathon track/brief this pack was built for. | Free text. |
| `requirements` | array | The list of evaluation criteria described below. | See per-requirement fields. |

### Each entry in `requirements[]`

| Field | Type | Meaning |
|---|---|---|
| `field` | string | The exact key name in `suppliers.json` that this requirement checks. |
| `label` | string | Human-readable name of the requirement. |
| `requirement` | string | Plain-English statement of the rule. |
| `operator` / `value` | string / number | For numeric requirements, the comparison to apply (e.g. `>=`, `<=`) and the threshold. |
| `acceptable_values` | array | For categorical requirements (region), the allowed set. |
| `constraint_type` | string | Either `"hard"` or `"soft"` (see below). |
| `rationale` | string | Why the requirement exists / why it is hard or soft. |

### Hard vs. soft requirements in this brief

| Requirement | Type | Why |
|---|---|---|
| Certification (ISO9001 or IATF16949, currently valid) | **Hard** | Quality-system gate; suppliers without it are structurally disqualified. |
| Minimum monthly capacity (>= 20,000 units) | **Hard** | Below this, the supplier physically cannot meet demand; not a negotiation. |
| Minimum quality history score (>= 85) | **Hard** | Track record floor tied to defect-rate/audit history; not negotiable. |
| Maximum MOQ (<= 5,000 units) | **Soft** | Can often be negotiated down or split across a phased PO. |
| Maximum lead time (<= 45 days) | **Soft** | Can sometimes be closed with expedited freight or partial shipments. |
| Acceptable region (NA / Western Europe / SE Asia) | **Soft** | Preference for logistics/tariffs; a strong supplier elsewhere could still be reviewed. |
| Minimum sustainability score (>= 60) | **Soft** | Can be waived pending a corrective action plan. |

**Eligibility rule used for the zero-eligible baseline:** a supplier is
"eligible" only if it passes **all** hard requirements **and** all soft
requirements. Failing any hard requirement is an automatic disqualification.
Failing a soft requirement does not disqualify a supplier from being
*shortlisted for negotiation*, but does disqualify it from the strict
"fully eligible today" baseline that this dataset is designed to return as
zero.

---

## 2. suppliers.json

| Field | Type | Meaning | Valid values / range |
|---|---|---|---|
| `product_id` | string | Which product this supplier list was evaluated against. | Matches `product_brief.json` → `product_id`. |
| `suppliers` | array | List of supplier profile objects. | See below. |

### Each entry in `suppliers[]`

| Field | Type | Meaning | Valid values / range |
|---|---|---|---|
| `source_id` | string | Stable citation ID for this supplier record (used for traceability/citations in the app). | Format `SUP-###`, unique. |
| `source_row` | integer | Row number in the original (synthetic) source table, for citation. | Positive integer, unique. |
| `supplier_name` | string | Supplier's display name. | Free text. |
| `region` | string | Manufacturing region of the supplier's primary plant for this part. | Any region string; compared against `product_brief.json`'s `acceptable_values` for the region requirement. |
| `country` | string | Country of the primary plant. | Free text, informational. |
| `certification.type` | string | Which certification the supplier holds. | `"ISO9001"`, `"IATF16949"`, or other. |
| `certification.status` | string | Supplier's self-reported/registrar status of the certificate. | `"valid"`, `"expired"`, `"suspended"`, `"pending"`. |
| `certification.issued_date` | string (ISO date) | Date the certificate was issued. | `YYYY-MM-DD`. |
| `certification.expiry_date` | string (ISO date) | Date the certificate expires (or expired). | `YYYY-MM-DD`. Compare against today's date — if `status` says `"valid"` but `expiry_date` is in the past (or vice versa), treat the record as **conflicting/ambiguous** and flag it rather than auto-passing or auto-failing. |
| `moq_units` | integer | Supplier's minimum order quantity. | Positive integer, units. |
| `lead_time_days` | integer | Supplier's quoted lead time. | Positive integer, calendar days. |
| `monthly_capacity_units` | integer | Supplier's quoted sustainable monthly output for this part. | Positive integer, units/month. |
| `capacity_notes` | string (optional) | Free-text caveat when quoted capacity conflicts with audited/observed capacity. | Present only when there is a known conflict; absence means no known conflict. |
| `quality_history_score` | integer | Composite score (0–100) built from defect rate, audit results, and on-time delivery history on prior lots. | 0–100. |
| `sustainability_score` | integer (optional) | Composite ESG score (0–100) from emissions reporting, energy sourcing, and waste handling. | 0–100. **May be absent** — absence means the data was never collected, not that the score is zero. |
| `data_flags` | array of strings | Machine-readable flags for known data-quality issues on this record (e.g. conflicting certification status, conflicting capacity figures, a missing field). Empty array means no known issues. | e.g. `"certification_status_conflict"`, `"capacity_figures_conflict"`, `"missing_field:sustainability_score"`. |
| `notes` | string | Human-readable summary of why the record passes, fails, or is flagged. | Free text. |

### Hard vs. soft fields (mirrors the brief)

| Supplier field | Type |
|---|---|
| `certification` | Hard |
| `monthly_capacity_units` | Hard |
| `quality_history_score` | Hard |
| `moq_units` | Soft |
| `lead_time_days` | Soft |
| `region` | Soft |
| `sustainability_score` | Soft |

### Handling ambiguous or missing data

- If `certification.status` and `certification.expiry_date` disagree (one
  implies valid, the other implies expired), the record is **not** auto-passed
  or auto-failed — it is flagged via `data_flags` and excluded from the
  "eligible" set until a human/agent verifies it with the supplier.
- If `monthly_capacity_units` conflicts with a note in `capacity_notes`, the
  same rule applies: flag, don't guess.
- If a required field (e.g. `sustainability_score`) is missing entirely, it is
  treated as "unknown," not as a pass or a zero — it is flagged via
  `data_flags` (`missing_field:<name>`) and excluded from the eligible set
  until the data is collected.
