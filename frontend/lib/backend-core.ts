/**
 * sourcefix/frontend/lib/backend-core.ts
 * =======================================
 * Pure TypeScript implementation of SourceFix deterministic core.
 * Enables 100% Standalone Vercel deployment with zero external backend dependencies.
 */

export type Supplier = {
  supplier_id: string;
  source_id?: string;
  name: string;
  supplier_name?: string;
  certifications?: Array<{ name?: string; type?: string; status?: string; expires?: string; expiry_date?: string }>;
  certification?: { type: string; status: string; expiry_date: string; issued_date?: string };
  moq: number;
  moq_units?: number;
  lead_time_days: number;
  location_region: string;
  region?: string;
  capacity_units_month: number;
  monthly_capacity_units?: number;
  quality_history_score: number;
  sustainability_score: number;
  source_row?: number | null;
  data_flags?: string[];
  notes?: string;
  capacity_notes?: string;
};

export type Constraint = {
  field: string;
  label?: string;
  operator?: ">=" | "<=" | ">" | "<" | "==" | "!=";
  value?: number;
  acceptable_values?: string[];
  constraint_type?: "hard" | "soft";
  requirement?: string;
  acceptable_cert_types?: string[];
};

export function normalizeSupplier(s: Supplier): Supplier {
  const n = { ...s };
  n.supplier_id = n.supplier_id || n.source_id || "UNKNOWN";
  n.source_id = n.supplier_id;
  n.name = n.name || n.supplier_name || `Supplier ${n.supplier_id}`;
  n.supplier_name = n.name;
  n.moq = n.moq ?? n.moq_units ?? 5000;
  n.moq_units = n.moq;
  n.lead_time_days = n.lead_time_days ?? 45;
  n.location_region = n.location_region || n.region || "North America";
  n.region = n.location_region;
  n.capacity_units_month = n.capacity_units_month ?? n.monthly_capacity_units ?? 20000;
  n.monthly_capacity_units = n.capacity_units_month;
  n.quality_history_score = n.quality_history_score ?? 85;
  n.sustainability_score = n.sustainability_score ?? 60;

  if (!n.certification && n.certifications && Array.isArray(n.certifications) && n.certifications.length > 0) {
    const first = n.certifications[0];
    const type = first.name || first.type || "ISO9001";
    const status = first.status || "valid";
    const expiry_date = first.expires || first.expiry_date || "2027-12-31";
    n.certification = { type, status, expiry_date };
  } else if (!n.certifications && n.certification) {
    n.certifications = [{
      name: n.certification.type,
      status: n.certification.status,
      expires: n.certification.expiry_date
    }];
  }

  return n;
}

export function checkConstraint(
  rawSupplier: Supplier,
  constraint: Constraint,
  referenceDateStr: string = "2026-08-08"
): { passed: boolean; reason: string } {
  const supplier = normalizeSupplier(rawSupplier);
  const field = constraint.field;
  const label = `${supplier.supplier_id} (${supplier.name})`;
  const refDate = Date.parse(referenceDateStr);

  // Certification check
  if (field === "certification") {
    const cert = supplier.certification;
    if (!cert || typeof cert !== "object") {
      return { passed: false, reason: `${label}: 'certification' field is missing entirely.` };
    }

    const certType = cert.type;
    const status = cert.status;
    const expiryRaw = cert.expiry_date;
    const acceptedTypes = constraint.acceptable_cert_types || ["ISO9001", "IATF16949"];

    if (!expiryRaw || isNaN(Date.parse(expiryRaw))) {
      return {
        passed: false,
        reason: `${label}: certification expiry_date ('${expiryRaw}') is missing or unparseable.`
      };
    }

    const expiryDate = Date.parse(expiryRaw);
    const statusSaysValid = status === "valid";
    const dateSaysValid = expiryDate >= refDate;

    if (statusSaysValid !== dateSaysValid) {
      return {
        passed: false,
        reason: `${label}: AMBIGUOUS certification record -- status field says '${status}' but expiry_date ${expiryRaw} ${
          dateSaysValid ? "is still in the future" : "is already in the past"
        } as of ${referenceDateStr}.`
      };
    }

    if (!acceptedTypes.includes(certType)) {
      return {
        passed: false,
        reason: `${label}: certification type '${certType}' is not one of the accepted types (${acceptedTypes.join(", ")}).`
      };
    }

    if (!statusSaysValid) {
      return {
        passed: false,
        reason: `${label}: certification status is '${status}' (expiry_date ${expiryRaw}), not valid.`
      };
    }

    return {
      passed: true,
      reason: `${label}: certification ${certType} is valid through ${expiryRaw}.`
    };
  }

  // Get field value
  let value: unknown = (supplier as Record<string, unknown>)[field];
  if (value === undefined) {
    if (field === "region") value = supplier.location_region;
    if (field === "monthly_capacity_units") value = supplier.capacity_units_month;
    if (field === "moq_units") value = supplier.moq;
  }

  if (value === undefined || value === null) {
    return {
      passed: false,
      reason: `${label}: field '${field}' is missing from this supplier record; cannot verify.`
    };
  }

  // Categorical set check
  if (constraint.acceptable_values && Array.isArray(constraint.acceptable_values)) {
    const acceptable = constraint.acceptable_values;
    const passed = acceptable.includes(String(value));
    return {
      passed,
      reason: `${label}: ${field}='${value}' is ${passed ? "in" : "NOT in"} acceptable set [${acceptable.join(", ")}].`
    };
  }

  // Numeric check
  if (constraint.operator && constraint.value !== undefined) {
    const numVal = Number(value);
    const target = constraint.value;
    const op = constraint.operator;
    let passed = false;

    if (op === ">=") passed = numVal >= target;
    else if (op === "<=") passed = numVal <= target;
    else if (op === ">") passed = numVal > target;
    else if (op === "<") passed = numVal < target;
    else if (op === "==") passed = numVal === target;
    else if (op === "!=") passed = numVal !== target;

    return {
      passed,
      reason: `${label}: ${field}=${numVal} ${passed ? "satisfies" : "fails"} requirement (${op} ${target}).`
    };
  }

  return { passed: false, reason: `Malformed constraint for field '${field}'.` };
}

export function eligibilityFilter(
  suppliers: Supplier[],
  constraints: Constraint[],
  referenceDateStr: string = "2026-08-08"
): {
  results: Record<string, Record<string, { passed: boolean; reason: string; constraint_type: string }>>;
  eligible: string[];
} {
  const results: Record<string, Record<string, { passed: boolean; reason: string; constraint_type: string }>> = {};
  const eligible: string[] = [];

  for (const rawS of suppliers) {
    const s = normalizeSupplier(rawS);
    const sid = s.supplier_id;
    const fieldResults: Record<string, { passed: boolean; reason: string; constraint_type: string }> = {};
    let allPassed = true;

    for (const c of constraints) {
      const field = c.field;
      const cType = c.constraint_type || "soft";
      const { passed, reason } = checkConstraint(s, c, referenceDateStr);
      fieldResults[field] = { passed, reason, constraint_type: cType };
      if (!passed) allPassed = false;
    }

    results[sid] = fieldResults;
    if (allPassed) eligible.push(sid);
  }

  return { results, eligible };
}

export function countFailuresByField(
  suppliers: Supplier[],
  constraints: Constraint[],
  referenceDateStr: string = "2026-08-08"
): Record<string, number> {
  const { results } = eligibilityFilter(suppliers, constraints, referenceDateStr);
  const counts: Record<string, number> = {};

  for (const sid of Object.keys(results)) {
    const checks = results[sid];
    for (const field of Object.keys(checks)) {
      if (!checks[field].passed) {
        counts[field] = (counts[field] || 0) + 1;
      }
    }
  }

  return counts;
}

export function sensitivityReport(
  suppliers: Supplier[],
  constraints: Constraint[],
  referenceDateStr: string = "2026-08-08"
): Array<{
  field: string;
  label?: string;
  original_value: unknown;
  original_operator?: string;
  original_acceptable_values?: string[];
  rescued_suppliers: Array<{ supplier_id: string; supplier_name: string; failed_field_value: unknown }>;
}> {
  const baseline = eligibilityFilter(suppliers, constraints, referenceDateStr);
  const baselineEligible = new Set(baseline.eligible);
  const report: Array<{
    field: string;
    label?: string;
    original_value: unknown;
    original_operator?: string;
    original_acceptable_values?: string[];
    rescued_suppliers: Array<{ supplier_id: string; supplier_name: string; failed_field_value: unknown }>;
  }> = [];

  const softConstraints = constraints.filter((c) => c.constraint_type === "soft");

  for (const targetC of softConstraints) {
    const field = targetC.field;
    const modifiedConstraints = constraints.filter((c) => c.field !== field);
    const relaxedRun = eligibilityFilter(suppliers, modifiedConstraints, referenceDateStr);
    const newEligible = relaxedRun.eligible.filter((sid) => !baselineEligible.has(sid));

    if (newEligible.length > 0) {
      const rescued = newEligible.map((sid) => {
        const s = normalizeSupplier(suppliers.find((sup) => (sup.supplier_id || sup.source_id) === sid)!);
        let val: unknown = (s as Record<string, unknown>)[field];
        if (val === undefined) {
          if (field === "region") val = s.location_region;
          if (field === "monthly_capacity_units") val = s.capacity_units_month;
          if (field === "moq_units") val = s.moq;
        }
        return {
          supplier_id: sid,
          supplier_name: s.name,
          failed_field_value: val
        };
      });

      report.push({
        field,
        label: targetC.label || field,
        original_value: targetC.value,
        original_operator: targetC.operator,
        original_acceptable_values: targetC.acceptable_values,
        rescued_suppliers: rescued
      });
    }
  }

  return report;
}
