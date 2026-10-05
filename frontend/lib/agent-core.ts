/**
 * sourcefix/frontend/lib/agent-core.ts
 * =====================================
 * LangGraph agent loop implementation in TypeScript for Vercel Serverless execution.
 *
 * Every LLM call is logged (step, model, HTTP status, duration -- never the API
 * key). Whenever an LLM call fails and a deterministic fallback is used instead,
 * the result is explicitly labeled with FALLBACK_LABEL in the state, ledger and
 * shortlist so the UI can show it. Fallback values and text are computed from
 * the supplier data and working constraints only -- no hardcoded supplier IDs
 * or numbers.
 */

import {
  Supplier,
  Constraint,
  normalizeSupplier,
  eligibilityFilter,
  countFailuresByField,
} from "./backend-core";

export const FALLBACK_LABEL = "deterministic fallback, no LLM";
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

export type DecisionSource = "llm" | "deterministic_fallback";
type FilterResult = ReturnType<typeof eligibilityFilter>;

export type LlmCallRecord = {
  step: "propose_relaxation" | "finalize";
  iteration: number;
  model: string;
  ok: boolean;
  status?: number;
  duration_ms: number;
  error?: string;
};

export type LedgerEntry = {
  iteration: number;
  field: string;
  label?: string;
  old_value: unknown;
  new_value: unknown;
  rationale: string;
  accepted: boolean;
  reason?: string;
  source: DecisionSource;
  fallback_reason?: string;
  original_constraint: Constraint;
  relaxed_constraint?: Constraint;
  unlocked_supplier_ids: string[];
};

export type AgentState = {
  suppliers: Supplier[];
  original_constraints: Constraint[];
  working_constraints: Constraint[];
  filter_result: FilterResult | null;
  relaxation_ledger: LedgerEntry[];
  eligible_suppliers: string[];
  pending_relaxation: {
    field: string;
    new_value: unknown;
    rationale: string;
    source: DecisionSource;
    fallback_reason?: string;
  } | null;
  llm_calls: LlmCallRecord[];
  status: "running" | "shortlisted" | "no_shortlist_found";
  ranking_source?: DecisionSource;
  ranking_fallback_reason?: string;
  final_shortlist: Array<{
    rank: number;
    supplier_id: string;
    supplier_name: string;
    explanation: string;
    explanation_source: DecisionSource;
    citations: Record<string, unknown>;
  }>;
  message: string;
  iteration: number;
  max_iterations: number;
  reference_date: string;
};

const PROPOSE_SYSTEM_PROMPT = `You are the relaxation-proposal component of a sourcing negotiation agent.
Zero suppliers currently meet every requirement. Suggest ONE soft (negotiable) requirement to loosen, and a specific new value for it.
Hard rules:
- You may ONLY choose a field from the soft constraints list you are given. Never propose a hard constraint -- it will be rejected.
- Do not repeat a relaxation listed as already tried.
- Reply with ONLY a single JSON object, no prose:
{"field": "<soft constraint field>", "new_value": <number, or a list of strings for categorical fields>, "rationale": "<one short sentence grounded in the numbers you were given>"}`;

const FINALIZE_SYSTEM_PROMPT = `You are the final-ranking component of a sourcing negotiation agent.
You are given suppliers that already passed every current requirement, plus the exact field values the filter evaluated.
ABSOLUTE RULES:
- Do not state any fact or number that is not literally present in the data given.
- Write each claim as field=value (e.g. quality_history_score=90) using the exact field names given.
- If there is no data-grounded reason to prefer one supplier over another, say they are tied.
Reply with ONLY a single JSON object:
{"ranked_supplier_ids": ["<supplier_id>", ...], "explanations": {"<supplier_id>": "<short data-grounded explanation>"}}`;

class GroqCallError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

function redact(text: string): string {
  return text.replace(/gsk_[A-Za-z0-9]+/g, "gsk_[REDACTED]").slice(0, 300);
}

async function callGroqAPI(
  step: LlmCallRecord["step"],
  iteration: number,
  systemPrompt: string,
  userPrompt: string,
  apiKey: string,
  log: LlmCallRecord[],
): Promise<string> {
  const started = Date.now();
  const doFetch = () =>
    fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        seed: 42,
        response_format: { type: "json_object" },
      }),
    });

  try {
    let response = await doFetch();
    // One retry on rate limit / transient server error, honoring retry-after (capped).
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Math.min(Number(response.headers.get("retry-after")) || 2, 10);
      console.warn(`[sourcefix][llm] step=${step} iteration=${iteration} status=${response.status} retrying in ${retryAfter}s`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      response = await doFetch();
    }
    if (!response.ok) {
      const errorText = await response.text();
      throw new GroqCallError(`Groq API error (${response.status}): ${redact(errorText)}`, response.status);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new GroqCallError("Groq API returned an empty completion", response.status);
    }
    const record: LlmCallRecord = { step, iteration, model: GROQ_MODEL, ok: true, status: response.status, duration_ms: Date.now() - started };
    log.push(record);
    console.log(`[sourcefix][llm] step=${step} iteration=${iteration} model=${GROQ_MODEL} status=${response.status} ok=true duration_ms=${record.duration_ms}`);
    return content;
  } catch (err) {
    const status = err instanceof GroqCallError ? err.status : undefined;
    const message = redact(err instanceof Error ? err.message : String(err));
    log.push({ step, iteration, model: GROQ_MODEL, ok: false, status, duration_ms: Date.now() - started, error: message });
    console.error(`[sourcefix][llm] step=${step} iteration=${iteration} model=${GROQ_MODEL} status=${status ?? "n/a"} ok=false error=${message}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Data helpers (mirror the field lookup used by backend-core.checkConstraint)
// ---------------------------------------------------------------------------

function supplierFieldValue(s: Supplier, field: string): unknown {
  if (field === "certification") return s.certification;
  let value: unknown = (s as Record<string, unknown>)[field];
  if (value === undefined) {
    if (field === "region") value = s.location_region;
    if (field === "monthly_capacity_units") value = s.capacity_units_month;
    if (field === "moq_units") value = s.moq;
  }
  return value;
}

function constraintValue(c: Constraint): unknown {
  return c.acceptable_values ?? c.value;
}

function fmt(v: unknown): string {
  if (Array.isArray(v)) return `[${v.join(", ")}]`;
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function describeRequirement(c: Constraint): string {
  if (c.field === "certification") return `valid ${(c.acceptable_cert_types || ["ISO9001", "IATF16949"]).join("/")}`;
  if (c.acceptable_values) return `in ${fmt(c.acceptable_values)}`;
  return `${c.operator} ${c.value}`;
}

/** Deterministic fallback proposal, computed only from filter results + data. */
function computeFallbackProposal(
  state: AgentState,
  filterRes: FilterResult,
  counts: Record<string, number>,
  fallbackReason: string,
): AgentState["pending_relaxation"] {
  const visited = new Set(state.relaxation_ledger.filter((e) => e.accepted).map((e) => `${e.field}=${fmt(e.new_value)}`));
  const soft = state.working_constraints.filter((c) => c.constraint_type === "soft" && (counts[c.field] || 0) > 0);

  const ranked = soft
    .map((c) => {
      const failers = Object.entries(filterRes.results)
        .filter(([, checks]) => checks[c.field] && !checks[c.field].passed)
        .map(([sid]) => sid);
      const soleFailers = failers.filter((sid) =>
        Object.entries(filterRes.results[sid]).every(([f, r]) => r.passed || f === c.field),
      );
      return { c, failers, soleFailers };
    })
    .sort((a, b) => b.soleFailers.length - a.soleFailers.length || b.failers.length - a.failers.length);

  for (const { c, failers, soleFailers } of ranked) {
    const pool = soleFailers.length ? soleFailers : failers;
    const values = pool
      .map((sid) => {
        const sup = state.suppliers.find((s) => s.supplier_id === sid);
        return { sid, v: sup ? supplierFieldValue(sup, c.field) : undefined };
      })
      .filter((x) => x.v !== undefined && x.v !== null);
    if (!values.length) continue;

    let newValue: unknown;
    let nearest: { sid: string; v: unknown };
    if (c.acceptable_values) {
      nearest = values[0];
      newValue = Array.from(new Set([...c.acceptable_values, ...values.map((x) => String(x.v))]));
    } else if (c.operator === ">=" || c.operator === "<=") {
      const numeric = values.filter((x) => Number.isFinite(Number(x.v)));
      if (!numeric.length) continue;
      nearest = numeric.reduce((best, x) =>
        c.operator === ">=" ? (Number(x.v) > Number(best.v) ? x : best) : (Number(x.v) < Number(best.v) ? x : best),
      );
      newValue = Number(nearest.v);
    } else {
      continue; // no data-derived rule for this operator; do not guess
    }
    if (visited.has(`${c.field}=${fmt(newValue)}`)) continue;

    return {
      field: c.field,
      new_value: newValue,
      source: "deterministic_fallback",
      fallback_reason: fallbackReason,
      rationale:
        `[${FALLBACK_LABEL}] ${c.field} fails for ${failers.length} supplier(s), ${soleFailers.length} of which fail only this soft constraint. ` +
        `Relaxing ${fmt(constraintValue(c))} -> ${fmt(newValue)} admits the nearest failing value ${fmt(nearest.v)} (${nearest.sid}).`,
    };
  }
  return null;
}

/** Deterministic fallback explanation, computed only from the supplier record + constraints. */
function groundedFallbackExplanation(sup: Supplier, constraints: Constraint[], reason: string): string {
  const parts = constraints.map((c) => {
    if (c.field === "certification") {
      const cert = sup.certification;
      return cert ? `certification=${cert.type} (status ${cert.status}, expires ${cert.expiry_date})` : "certification=missing";
    }
    return `${c.field}=${fmt(supplierFieldValue(sup, c.field))} (requirement ${describeRequirement(c)})`;
  });
  return `[${FALLBACK_LABEL}: ${reason}] Passes all ${constraints.length} working constraints: ${parts.join("; ")}.`;
}

function parseProposal(raw: string, working: Constraint[]): { field?: string; new_value?: unknown; rationale?: string } {
  const parsed = JSON.parse(raw);
  const field = typeof parsed.field === "string" ? parsed.field : undefined;
  let newValue = parsed.new_value;
  // Accept the older {"proposed_relaxation": {...}} shape too.
  if (newValue === undefined && parsed.proposed_relaxation !== undefined) {
    const pr = parsed.proposed_relaxation;
    const target = working.find((c) => c.field === field);
    newValue = pr && typeof pr === "object" ? (target?.acceptable_values ? pr.acceptable_values : pr.value) : pr;
  }
  return { field, new_value: newValue, rationale: typeof parsed.rationale === "string" ? parsed.rationale : undefined };
}

export async function* runAgentStream(
  suppliers: Supplier[],
  constraints: Constraint[],
  maxIterations: number = 5,
  referenceDate: string = "2026-08-08",
  groqApiKey?: string
): AsyncGenerator<{ node: string; state: AgentState; complete?: boolean }, void, unknown> {
  const apiKey = groqApiKey || process.env.GROQ_API_KEY || "";
  if (!apiKey) {
    throw new Error("GROQ_API_KEY environment variable is not configured. Set GROQ_API_KEY in frontend/.env.local (local dev) or in the Vercel project environment variables.");
  }

  let state: AgentState = {
    suppliers: suppliers.map(normalizeSupplier),
    original_constraints: constraints,
    working_constraints: constraints.map((c) => ({ ...c })),
    filter_result: null,
    relaxation_ledger: [],
    eligible_suppliers: [],
    pending_relaxation: null,
    llm_calls: [],
    status: "running",
    final_shortlist: [],
    message: "Starting agent loop...",
    iteration: 0,
    max_iterations: maxIterations,
    reference_date: referenceDate,
  };

  while (state.iteration <= maxIterations && state.status === "running") {
    state.iteration += 1;

    // Node 1: run_filter
    const filterRes = eligibilityFilter(state.suppliers, state.working_constraints, state.reference_date);
    state.filter_result = filterRes;
    state.eligible_suppliers = filterRes.eligible;
    state.pending_relaxation = null;

    if (filterRes.eligible.length > 0) {
      state.message = `Found ${filterRes.eligible.length} eligible supplier(s). Finalizing shortlist.`;
      yield { node: "run_filter", state };
      break;
    }

    if (state.iteration > maxIterations) {
      state.status = "no_shortlist_found";
      state.message = `Reached maximum iterations (${maxIterations}) without finding any eligible suppliers.`;
      yield { node: "give_up", state, complete: true };
      return;
    }

    state.message = `Filter ran (iteration ${state.iteration}): 0 suppliers eligible. Requesting relaxation proposal...`;
    yield { node: "run_filter", state };

    // Node 2: propose_relaxation
    const counts = countFailuresByField(state.suppliers, state.working_constraints, state.reference_date);
    const softConstraints = state.working_constraints.filter((c) => c.constraint_type === "soft");

    if (softConstraints.length === 0) {
      state.status = "no_shortlist_found";
      state.message = "No soft constraints remain to relax.";
      yield { node: "give_up", state, complete: true };
      return;
    }

    let llmProposal: { field?: string; new_value?: unknown; rationale?: string } | null = null;
    let fallbackReason = "";
    try {
      const softLines = softConstraints.map((c) => {
        const failers = Object.entries(filterRes.results)
          .filter(([, checks]) => checks[c.field] && !checks[c.field].passed)
          .map(([sid]) => sid);
        const soleFailers = failers.filter((sid) =>
          Object.entries(filterRes.results[sid]).every(([f, r]) => r.passed || f === c.field),
        );
        const nearMissVals = soleFailers
          .map((sid) => {
            const sup = state.suppliers.find((s) => s.supplier_id === sid);
            return sup ? supplierFieldValue(sup, c.field) : undefined;
          })
          .filter((v) => v !== undefined && v !== null);
        return `- field="${c.field}", current_value=${fmt(constraintValue(c))}, suppliers_currently_failing_this=${counts[c.field] || 0}, suppliers_rescued_if_relaxed=${soleFailers.length}${nearMissVals.length ? `, nearest_failing_values=[${nearMissVals.join(", ")}]` : ""}`;
      });
      const tried = state.relaxation_ledger.filter((e) => e.accepted).map((e) => `- field="${e.field}", new_value=${fmt(e.new_value)}`);
      const userPrompt =
        `Soft constraints currently in play (choose ONLY from these):\n${softLines.join("\n")}\n\n` +
        (tried.length ? `Relaxations already applied (do not repeat):\n${tried.join("\n")}\n\n` : "No relaxations applied yet.\n\n") +
        `Respond with JSON only.`;
      const rawJson = await callGroqAPI("propose_relaxation", state.iteration, PROPOSE_SYSTEM_PROMPT, userPrompt, apiKey, state.llm_calls);
      llmProposal = parseProposal(rawJson, state.working_constraints);
      if (!llmProposal.field || llmProposal.new_value === undefined) {
        fallbackReason = "LLM reply was missing 'field' or 'new_value'";
        llmProposal = null;
      }
    } catch (err) {
      fallbackReason = `LLM call failed: ${redact(err instanceof Error ? err.message : String(err))}`;
    }

    if (llmProposal) {
      state.pending_relaxation = {
        field: llmProposal.field!,
        new_value: llmProposal.new_value,
        rationale: llmProposal.rationale || "(LLM gave no rationale)",
        source: "llm",
      };
    } else {
      state.pending_relaxation = computeFallbackProposal(state, filterRes, counts, fallbackReason);
      if (!state.pending_relaxation) {
        state.status = "no_shortlist_found";
        state.message = `No relaxation available: LLM unavailable (${fallbackReason}) and no data-derived ${FALLBACK_LABEL} proposal exists. Manual review needed.`;
        yield { node: "give_up", state, complete: true };
        return;
      }
    }

    const proposal = state.pending_relaxation;
    const proposedField = proposal.field;
    state.message =
      proposal.source === "llm"
        ? `Proposed relaxing '${proposedField}' (LLM): ${proposal.rationale}`
        : `Proposed relaxing '${proposedField}' (${FALLBACK_LABEL}; ${proposal.fallback_reason})`;
    yield { node: "propose_relaxation", state };

    // Node 3: apply_relaxation (Code Gate) -- the soft/hard check below is unchanged:
    // only a field whose constraint_type in OUR working_constraints is "soft" may change.
    const existingIdx = state.working_constraints.findIndex((c) => c.field === proposedField);
    if (existingIdx !== -1 && state.working_constraints[existingIdx].constraint_type === "soft") {
      const targetC = state.working_constraints[existingIdx];
      const relaxedC = { ...targetC };
      if (Array.isArray(proposal.new_value)) relaxedC.acceptable_values = proposal.new_value.map(String);
      else if (proposal.new_value !== undefined) relaxedC.value = Number(proposal.new_value);

      state.working_constraints[existingIdx] = relaxedC;

      // Re-filter to find unlocked suppliers
      const newFilter = eligibilityFilter(state.suppliers, state.working_constraints, state.reference_date);
      const unlocked = newFilter.eligible;

      state.relaxation_ledger.push({
        iteration: state.iteration,
        field: proposedField,
        label: targetC.label || proposedField,
        old_value: constraintValue(targetC),
        new_value: constraintValue(relaxedC),
        rationale: proposal.rationale,
        accepted: true,
        source: proposal.source,
        fallback_reason: proposal.fallback_reason,
        original_constraint: targetC,
        relaxed_constraint: relaxedC,
        unlocked_supplier_ids: unlocked,
      });

      state.message = `Applied relaxation to '${proposedField}': ${fmt(constraintValue(targetC))} -> ${fmt(constraintValue(relaxedC))}. ${unlocked.length} supplier(s) now eligible.`;
    } else {
      const target = existingIdx !== -1 ? state.working_constraints[existingIdx] : undefined;
      const reason = target
        ? `Proposal targets '${proposedField}' with constraint_type='${target.constraint_type}'. Only soft constraints may be relaxed; rejected without applying anything.`
        : `Proposal targets '${proposedField}', which does not exist in working_constraints; rejected without applying anything.`;
      state.relaxation_ledger.push({
        iteration: state.iteration,
        field: proposedField,
        label: target?.label || proposedField,
        old_value: target ? constraintValue(target) : undefined,
        new_value: proposal.new_value,
        rationale: proposal.rationale,
        accepted: false,
        reason,
        source: proposal.source,
        fallback_reason: proposal.fallback_reason,
        original_constraint: target ?? { field: proposedField },
        unlocked_supplier_ids: [],
      });
      state.message = `Rejected proposal for '${proposedField}' (not a soft constraint).`;
    }

    yield { node: "apply_relaxation", state };
  }

  // Node 4: finalize (if eligible suppliers found)
  if (state.eligible_suppliers.length > 0) {
    const eligibleSups = state.suppliers.filter((s) => state.eligible_suppliers.includes(s.supplier_id));

    let finalRankedIds = state.eligible_suppliers;
    let explanations: Record<string, string> = {};
    let rankingFallbackReason = "";

    try {
      const payload = eligibleSups.map((s) => ({
        supplier_id: s.supplier_id,
        field_values: Object.fromEntries(state.working_constraints.map((c) => [c.field, supplierFieldValue(s, c.field)])),
        filter_breakdown: state.filter_result?.results[s.supplier_id],
      }));
      const userPrompt = `Ground-truth data for every eligible supplier. Rank and explain using ONLY this data:\n${JSON.stringify(payload, null, 2)}`;
      const rawJson = await callGroqAPI("finalize", state.iteration, FINALIZE_SYSTEM_PROMPT, userPrompt, apiKey, state.llm_calls);
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed.ranked_supplier_ids)) {
        // Never let the model introduce a supplier that did not pass the filter,
        // and never let it silently drop one that did.
        finalRankedIds = parsed.ranked_supplier_ids.filter((id: string) => state.eligible_suppliers.includes(id));
        for (const id of state.eligible_suppliers) if (!finalRankedIds.includes(id)) finalRankedIds.push(id);
      } else {
        rankingFallbackReason = "LLM reply had no ranked_supplier_ids list";
      }
      if (parsed.explanations && typeof parsed.explanations === "object") {
        explanations = parsed.explanations;
      }
    } catch (err) {
      rankingFallbackReason = `LLM call failed: ${redact(err instanceof Error ? err.message : String(err))}`;
    }

    if (rankingFallbackReason) {
      finalRankedIds = [...state.eligible_suppliers].sort((a, b) => {
        const sA = eligibleSups.find((s) => s.supplier_id === a)!;
        const sB = eligibleSups.find((s) => s.supplier_id === b)!;
        return (sB.quality_history_score || 0) - (sA.quality_history_score || 0);
      });
      state.ranking_source = "deterministic_fallback";
      state.ranking_fallback_reason = `${rankingFallbackReason}; ordered by quality_history_score descending`;
    } else {
      state.ranking_source = "llm";
    }

    state.final_shortlist = finalRankedIds.map((id, index) => {
      const sup = eligibleSups.find((s) => s.supplier_id === id)!;
      const llmText = typeof explanations[id] === "string" && explanations[id].trim() ? explanations[id] : null;
      return {
        rank: index + 1,
        supplier_id: id,
        supplier_name: sup.name,
        explanation:
          llmText ??
          groundedFallbackExplanation(sup, state.working_constraints, rankingFallbackReason || "LLM omitted an explanation for this supplier"),
        explanation_source: llmText ? "llm" : "deterministic_fallback",
        citations: {
          supplier_id: id,
          supplier_name: sup.name,
          source_row: sup.source_row ?? null,
          quality_history_score: sup.quality_history_score,
          lead_time_days: sup.lead_time_days,
          monthly_capacity_units: sup.capacity_units_month,
        },
      };
    });

    const fallbackCount = state.final_shortlist.filter((s) => s.explanation_source === "deterministic_fallback").length;
    state.status = "shortlisted";
    state.message =
      `Successfully finalized shortlist of ${state.final_shortlist.length} supplier(s).` +
      (state.ranking_source === "deterministic_fallback" ? ` Ranking: ${FALLBACK_LABEL} (${state.ranking_fallback_reason}).` : " Ranking: LLM.") +
      (fallbackCount ? ` ${fallbackCount} explanation(s): ${FALLBACK_LABEL}.` : "");
    yield { node: "finalize", state, complete: true };
  } else {
    state.status = "no_shortlist_found";
    state.message = "No eligible suppliers found after maximum iterations.";
    yield { node: "give_up", state, complete: true };
  }
}
