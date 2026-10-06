# SourceFix | System Architecture & Deliverables

*SourceFix | AI Manufacturing Decision Copilot*

- 🌐 **Live Web Application**: [https://source-fix.vercel.app/](https://source-fix.vercel.app/)
- 🎥 **YouTube Video Demo**: [https://youtu.be/kdCmKI3OVuc](https://youtu.be/kdCmKI3OVuc)
- 📊 **Presentation Slide Deck**: [Google Slides Presentation](https://docs.google.com/presentation/d/1kDsACW6O3L37ypI7DrrTD72fo46XuLIM/edit?usp=sharing)

---

## 1. Intended user

SourceFix is built for a **sourcing/procurement lead** evaluating suppliers
for a new part (here, an injection-molded IoT enclosure) against a written
requirements brief. It supports one specific decision: *given today's
supplier data and today's requirements, is there anyone we can shortlist for
negotiation right now — and if the strict "everyone qualifies" bar returns
nobody, which single requirement is worth relaxing first, and why?* It is
meant to replace the first hour of a buyer manually cross-referencing a
spreadsheet against a requirements doc, not to replace the buyer's judgment,
supplier relationships, or sign-off authority.

## 2. Assumptions and limitations

- **The data is synthetic.** No real client dataset exists for this theme;
  both `product_brief.json` and `suppliers.json` are hand-authored test
  fixtures built to exercise specific cases (clean passes, near-misses,
  hard disqualifications, and one deliberately ambiguous certification
  record). See `backend/app/data/source_manifest.md`.
- **The tool never contacts suppliers or places orders.** Every function in
  `tools.py` and every node in `nodes.py` reads from and reasons about the
  in-memory dataset only. There is no outbound integration to a supplier
  portal, ERP, or procurement system anywhere in this codebase.
- **"Eligible" is only as accurate as the input profile data.** The system
  has no independent way to verify a supplier's self-reported certification
  status, capacity, or quality score; it can flag *internal* inconsistencies
  in that data (see the ambiguous-certification case) but cannot detect a
  record that is wrong yet internally consistent.
- **Relaxation is single-constraint only in this version.** Each accepted
  relaxation loosens exactly one soft field per iteration
  (`apply_relaxation_node` applies one proposal at a time); the agent does
  not currently propose or evaluate combined multi-field relaxations (e.g.
  "loosen MOQ *and* lead time together") in a single step.

## 3. Human-approval points (critical boundary)

**Supplier approval, RFQs, and purchase orders are explicitly outside this
tool's scope.** SourceFix's output is a ranked, cited *shortlist for human
review* — nothing it produces authorizes spend, contact, or commitment.
Every relaxation the agent accepts is fully logged
(`relaxation_ledger`) precisely so a human reviewer can see and overrule
what changed before acting on it. Concretely:

- The tool never emits an RFQ, PO, or supplier-facing communication of any
  kind.
- Hard requirements (certification, minimum capacity, minimum quality
  history) are evaluated by deterministic code, not by the LLM. A code gate
  rejects any LLM proposal that targets a hard constraint — see the
  evaluation results below.
- Moving from "shortlisted by SourceFix" to "approved supplier" is, by
  design, a separate human action this tool does not perform.

## 4. Evaluation results

All numbers below are pulled directly from `backend/tests/` (pytest) and
`demo_cases/` (generated against the real FastAPI app and the bundled
dataset; see `demo_cases/EXPLANATION.md` for the full methodology,
including the note on simulated LLM calls). `demo_cases/verify_citations.py`
traces the citation numbers from the raw response JSON.

| Metric | Result | Source |
|---|---|---|
| Mandatory (hard) constraint enforcement | Rejects proposals targeting hard fields | Evaluated by deterministic code; `test_hard_constraint_is_never_relaxed_under_repeated_pressure` (4/4 adversarial hard-field proposals rejected) + demo cases 1 & 3 (4 soft-field proposals accepted, 0 hard-field proposals applied) |
| Citation audit | 10 of 10 field claims traced (demo case 1) | `demo_cases/verify_citations.py` — every `field=value` claim in case 1's final shortlist matched against `cite_lookup()` on the raw supplier record (demo cases only, small synthetic dataset) |
| Baseline comparison | **0 eligible** (rules-only baseline) → **2 eligible** after 1 accepted relaxation (case 1); **0 → 0** when every candidate fails a hard requirement (case 3, correctly no false rescue) | `case1_successful_relaxation.json`, `case3_failure_manual_review.json` |
| Full test suite | **25/25 passed** | `pytest -q` (15 test_tools, 6 test_agent, 4 test_suppliers_crud) |

**Per-case iteration count / completion time:**

| Case | Iterations | Wall-clock time* |
|---|---|---|
| 1 — Successful | 1 relaxation attempt (accepted) | 29 ms (baseline) + 20 ms (agent run) |
| 2 — Ambiguous | 0 (no agent loop — baseline call only) | 3 ms |
| 3 — Failure | 3 relaxation attempts (all accepted, none sufficient) | 12 ms |

\* Measured via `TestClient` in-process, with deterministic stand-in
functions substituted for the live Groq calls (see the note in
`demo_cases/EXPLANATION.md`) — these times reflect the deterministic
control-flow/graph overhead only, **not** real LLM API latency. A live run
will be dominated by the Groq round-trips instead.

**Per-case citation audit breakdown:**
- **Case 1 (Successful):** Emits a 2-supplier shortlist with LLM-written ranking explanations. `verify_citations.py` regex-extracts every `field=value` claim and verifies that 10 of 10 match `cite_lookup()` directly against `source_row` records in `suppliers.json` (demo cases only, small synthetic dataset).
- **Case 2 (Ambiguous):** Baseline eligibility filter call only — no agent loop or ranking explanation generated.
- **Case 3 (Failure):** Bounded negotiation loop that fails closed with `status: "no_shortlist_found"` and `final_shortlist: []`. Because no shortlist is generated, zero ranking claims are emitted to cite.

## 5. Architecture and data flow

```
                ┌─────────────────────────────────┐
                │   User Request / Constraints   │
                └────────────────┬────────────────┘
                                 │
                                 ▼
                   ┌───────────────────────────┐
                   │        run_filter         │  ◄── (Loop back on pass)
                   └─────────────┬─────────────┘
                                 │
                                 ▼
                   ┌───────────────────────────┐
                   │        decide_next        │
                   └──────┬──────┬──────┬──────┘
                          │      │      │
            Eligible? ────┘      │      └──── Max Iterations Hit?
                │                │                       │
                ▼                ▼                       ▼
      ┌───────────────────┐  (Incomplete)       ┌─────────────────┐
      │   finalize (LLM)  │      │              │     give_up     │
      └─────────┬─────────┘      ▼              └────────┬────────┘
                │       ┌───────────────────┐            │
                │       │propose_relaxation │            │
                │       └────────┬──────────┘            │
                │                │                       │
                │                ▼                       │
                │       ┌───────────────────┐            │
                │       │ apply_relaxation  │            │
                │       └────────┬──────────┘            │
                │                │ (Re-derive & log)     │
                │                └───────────────────────┤
                ▼                                        ▼
   ┌───────────────────────────┐           ┌───────────────────────────┐
   │ Final Shortlist + Reasons │           │   Manual Review Needed    │
   └───────────────────────────┘           └───────────────────────────┘
```

The deterministic core (`tools.py`: `eligibility_filter`,
`check_constraint`, `cite_lookup`, `sensitivity_report`) has no LLM
dependency and is independently testable — it's the ground truth the rest
of the system sits on. A LangGraph `StateGraph` (`graph.py`) wraps it in a
negotiation loop: `run_filter` → `decide_next` routes to `finalize` (if
anyone's eligible), `give_up` (if `max_iterations` is exhausted), or
`propose_relaxation` → `apply_relaxation` → back to `run_filter`. Two nodes
call an LLM — `propose_relaxation_node` (Groq, fast/cheap, runs per
attempt) and `rank_and_finalize_node` (Groq, careful, runs once — models are
configured via environment variables `GROQ_MODEL`, `GROQ_PROPOSE_MODEL`,
`GROQ_FINALIZE_MODEL`; the demo used `openai/gpt-oss-120b`) — but
neither is trusted blindly:
`apply_relaxation_node` re-derives `constraint_type` from
`working_constraints` (code-controlled, never LLM-written) before ever
accepting a proposal, and `rank_and_finalize_node`'s prompt forwards only
the exact fields the filter itself evaluated, so the ranking model has no
path to unsupported claims. `app/main.py` exposes this as a FastAPI service:
`/api/analyze` (full run, one JSON response), `/api/analyze/stream` (same
run, one SSE event per graph node for a live trace), and `/api/baseline`
(the deterministic filter alone, no agent, no LLM — the non-agent control).
