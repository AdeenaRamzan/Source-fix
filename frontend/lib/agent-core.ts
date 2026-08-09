/**
 * sourcefix/frontend/lib/agent-core.ts
 * =====================================
 * LangGraph agent loop implementation in TypeScript for Vercel Serverless execution.
 */

import {
  Supplier,
  Constraint,
  normalizeSupplier,
  eligibilityFilter,
  countFailuresByField,
} from "./backend-core";

export type AgentState = {
  suppliers: Supplier[];
  original_constraints: Constraint[];
  working_constraints: Constraint[];
  relaxation_ledger: Array<{
    field: string;
    label?: string;
    original_constraint: Constraint;
    relaxed_constraint: Constraint;
    rationale: string;
    unlocked_supplier_ids: string[];
    iteration: number;
  }>;
  eligible_suppliers: string[];
  status: "running" | "shortlisted" | "no_shortlist_found";
  final_shortlist: Array<{
    rank: number;
    supplier_id: string;
    supplier_name: string;
    explanation: string;
    citations: Record<string, unknown>;
  }>;
  message: string;
  iteration: number;
  max_iterations: number;
  reference_date: string;
};

const PROPOSE_SYSTEM_PROMPT = `You are an expert procurement agent helping a manufacturing team relax soft requirements.
You MUST reply with ONLY a single valid JSON object with keys: "field", "proposed_relaxation", "rationale".
Do NOT suggest relaxing hard constraints.`;

const FINALIZE_SYSTEM_PROMPT = `You are the final-ranking component of a sourcing negotiation agent.
Given eligible suppliers, rank them into a final shortlist with data-grounded explanations.
Reply with ONLY a valid JSON object containing:
"ranked_supplier_ids": ["<supplier_id>", ...], "explanations": {"<supplier_id>": "<explanation>"}`;

async function callGroqAPI(systemPrompt: string, userPrompt: string, apiKey: string): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || "{}";
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
    throw new Error("GROQ_API_KEY environment variable is not configured. Please set GROQ_API_KEY in your Vercel project environment variables.");
  }

  let state: AgentState = {
    suppliers: suppliers.map(normalizeSupplier),
    original_constraints: constraints,
    working_constraints: constraints.map((c) => ({ ...c })),
    relaxation_ledger: [],
    eligible_suppliers: [],
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
    state.eligible_suppliers = filterRes.eligible;

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

    let proposal: { field?: string; proposed_relaxation?: { operator?: string; value?: number; acceptable_values?: string[] }; rationale?: string } = {};

    try {
      const userPrompt = `Working constraints: ${JSON.stringify(state.working_constraints)}\nFailure counts per field: ${JSON.stringify(counts)}`;
      const rawJson = await callGroqAPI(PROPOSE_SYSTEM_PROMPT, userPrompt, apiKey);
      proposal = JSON.parse(rawJson);
    } catch {
      // Deterministic fallback if LLM call fails
      const topField = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
      const targetC = softConstraints.find((c) => c.field === topField) || softConstraints[0];

      let newC = { ...targetC };
      if (targetC.field === "moq_units" || targetC.field === "moq") newC.value = 6000;
      else if (targetC.field === "lead_time_days") newC.value = 60;
      else if (targetC.field === "sustainability_score") newC.value = 50;

      proposal = {
        field: targetC.field,
        proposed_relaxation: newC,
        rationale: `Relaxing ${targetC.field} to unlock candidates.`
      };
    }

    const proposedField = proposal.field || softConstraints[0].field;
    state.message = `Proposed relaxing '${proposedField}': ${proposal.rationale || "Expanding criteria."}`;
    yield { node: "propose_relaxation", state };

    // Node 3: apply_relaxation (Code Gate)
    const existingIdx = state.working_constraints.findIndex((c) => c.field === proposedField);
    if (existingIdx !== -1 && state.working_constraints[existingIdx].constraint_type === "soft") {
      const targetC = state.working_constraints[existingIdx];
      let relaxedC = { ...targetC };

      if (proposal.proposed_relaxation) {
        if (proposal.proposed_relaxation.value !== undefined) relaxedC.value = proposal.proposed_relaxation.value;
        if (proposal.proposed_relaxation.operator) relaxedC.operator = proposal.proposed_relaxation.operator as any;
        if (proposal.proposed_relaxation.acceptable_values) relaxedC.acceptable_values = proposal.proposed_relaxation.acceptable_values;
      } else {
        if (targetC.field === "moq_units" || targetC.field === "moq") relaxedC.value = 6000;
        else if (targetC.field === "lead_time_days") relaxedC.value = 60;
        else if (targetC.field === "sustainability_score") relaxedC.value = 50;
      }

      state.working_constraints[existingIdx] = relaxedC;

      // Re-filter to find unlocked suppliers
      const newFilter = eligibilityFilter(state.suppliers, state.working_constraints, state.reference_date);
      const unlocked = newFilter.eligible;

      state.relaxation_ledger.push({
        field: proposedField,
        label: targetC.label || proposedField,
        original_constraint: targetC,
        relaxed_constraint: relaxedC,
        rationale: proposal.rationale || `Relaxed ${proposedField}.`,
        unlocked_supplier_ids: unlocked,
        iteration: state.iteration,
      });

      state.message = `Applied relaxation to '${proposedField}'. ${unlocked.length} supplier(s) unlocked.`;
    } else {
      state.message = `Rejected proposal for '${proposedField}' (not a soft constraint).`;
    }

    yield { node: "apply_relaxation", state };
  }

  // Node 4: finalize (if eligible suppliers found)
  if (state.eligible_suppliers.length > 0) {
    const eligibleSups = state.suppliers.filter((s) => state.eligible_suppliers.includes(s.supplier_id));

    let finalRankedIds = state.eligible_suppliers;
    let explanations: Record<string, string> = {};

    try {
      const userPrompt = `Eligible suppliers: ${JSON.stringify(eligibleSups)}`;
      const rawJson = await callGroqAPI(FINALIZE_SYSTEM_PROMPT, userPrompt, apiKey);
      const parsed = JSON.parse(rawJson);
      if (parsed.ranked_supplier_ids && Array.isArray(parsed.ranked_supplier_ids)) {
        finalRankedIds = parsed.ranked_supplier_ids.filter((id: string) => state.eligible_suppliers.includes(id));
      }
      if (parsed.explanations && typeof parsed.explanations === "object") {
        explanations = parsed.explanations;
      }
    } catch {
      // Fallback ranking
      finalRankedIds = [...state.eligible_suppliers].sort((a, b) => {
        const sA = eligibleSups.find((s) => s.supplier_id === a)!;
        const sB = eligibleSups.find((s) => s.supplier_id === b)!;
        return (sB.quality_history_score || 0) - (sA.quality_history_score || 0);
      });
    }

    state.final_shortlist = finalRankedIds.map((id, index) => {
      const sup = eligibleSups.find((s) => s.supplier_id === id)!;
      return {
        rank: index + 1,
        supplier_id: id,
        supplier_name: sup.name,
        explanation: explanations[id] || `${sup.name} meets all working criteria with quality score ${sup.quality_history_score}.`,
        citations: {
          supplier_id: id,
          supplier_name: sup.name,
          source_row: sup.source_row || 1,
          quality_history_score: sup.quality_history_score,
          lead_time_days: sup.lead_time_days,
          monthly_capacity_units: sup.capacity_units_month,
        },
      };
    });

    state.status = "shortlisted";
    state.message = `Successfully finalized shortlist of ${state.final_shortlist.length} supplier(s).`;
    yield { node: "finalize", state, complete: true };
  } else {
    state.status = "no_shortlist_found";
    state.message = "No eligible suppliers found after maximum iterations.";
    yield { node: "give_up", state, complete: true };
  }
}
