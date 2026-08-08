# Source Manifest — SourceFix Challenge Pack

## Status: SYNTHETIC DATA — NOT REAL SUPPLIER DATA

No dataset was supplied for the "AI Manufacturing Decision Copilot" hackathon
theme (Track 1). Per the brief's instruction to build our own data based on
the theme requirements, the files in this directory were **generated
specifically for this hackathon prototype** and are **not** sourced from any
real supplier database, ERP export, procurement system, certification
registry, or third-party dataset.

## Files covered by this manifest

| File | Description | Origin |
|---|---|---|
| `product_brief.json` | One synthetic product (injection-molded IoT gateway enclosure) with hard/soft sourcing requirements. | Authored by the SourceFix team for this hackathon; not a real customer brief. |
| `suppliers.json` | 13 synthetic supplier profiles evaluated against the product brief. | Fabricated by the SourceFix team; company names, locations, certificates, and scores are invented and do not represent real companies. |

## Why this exists

The hackathon brief explicitly calls for "a data/source manifest" as a
required deliverable. Because this track provided no real-world dataset, that
manifest's primary job here is to be explicit that the underlying data is
fictional, so that:

- judges and reviewers do not mistake the supplier list for real market
  intelligence,
- any resemblance between a synthetic supplier name and a real company is
  coincidental and unintended,
- downstream demos, screenshots, or writeups built on this data are clearly
  understood as illustrative of the tool's *reasoning*, not as sourcing
  advice for an actual purchasing decision.

## How the data was constructed

- The product and its requirements were chosen to be plausible for a
  manufacturing sourcing scenario (certification, MOQ, lead time, region,
  capacity, quality history, sustainability) and to give the app's
  eligibility/negotiation logic enough surface area to be interesting.
- Supplier records were deliberately constructed with a spread of pass/fail
  outcomes across *different* fields (no single constraint blocks every
  supplier), plus:
  - one supplier with an internally conflicting certification record
    (status field vs. expiry date disagree) — `SUP-008`,
  - one supplier with a conflicting/undemonstrated capacity figure —
    also `SUP-008`,
  - one supplier missing a required field entirely (`sustainability_score`)
    — `SUP-009`,
  - a deliberate design constraint that **zero suppliers are currently
    fully eligible** against the combined hard + soft requirement set,
    which is the core scenario this product exists to help a buyer resolve
    (i.e., "nobody clears the bar today — where are the near-misses and
    what would it take to get one across the line?").
- Every supplier record carries a `source_id` and `source_row` so that any
  fact surfaced by the app can be cited back to a specific row in this
  synthetic dataset, mirroring how the app would cite a real source table.

## Explicitly not claimed

- This is **not** a scrape, export, or derivative of any real supplier
  directory, certification body, or trade database.
- No real company's confidential or proprietary data is included.
- Scores (`quality_history_score`, `sustainability_score`) are illustrative
  0–100 composites invented for this pack; they do not correspond to any
  real scoring methodology or rating agency.

## Maintainers

Generated for the SourceFix hackathon submission (Track 1: AI Manufacturing
Decision Copilot). Update this manifest if the synthetic data is ever
regenerated, expanded, or replaced with a real dataset.
