import { NextResponse } from "next/server";
import { eligibilityFilter, sensitivityReport, Constraint } from "../../../../lib/backend-core";
import { getStoreSuppliers } from "../../../../lib/supplier-store";

const defaultConstraints: Constraint[] = [
  { field: "certification", label: "Quality management certification", constraint_type: "hard", requirement: "Currently valid ISO9001 or IATF16949 certificate." },
  { field: "monthly_capacity_units", label: "Monthly production capacity", operator: ">=", value: 20000, constraint_type: "hard", requirement: "At least 20,000 units per month." },
  { field: "quality_history_score", label: "Quality history score", operator: ">=", value: 85, constraint_type: "hard", requirement: "A quality history score of at least 85." },
  { field: "moq_units", label: "Minimum order quantity", operator: "<=", value: 5000, constraint_type: "soft", requirement: "No more than 5,000 units." },
  { field: "lead_time_days", label: "Lead time", operator: "<=", value: 45, constraint_type: "soft", requirement: "No more than 45 days." },
  { field: "region", label: "Manufacturing region", constraint_type: "soft", acceptable_values: ["North America", "Western Europe", "Southeast Asia"], requirement: "North America, Western Europe, or Southeast Asia." },
  { field: "sustainability_score", label: "Sustainability score", operator: ">=", value: 60, constraint_type: "soft", requirement: "A sustainability score of at least 60." }
];

export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};

    if (process.env.SOURCEFIX_BACKEND_URL) {
      const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/baseline`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
    }

    const suppliers = body.suppliers || getStoreSuppliers();
    const constraints = body.constraints || defaultConstraints;
    const refDate = body.reference_date || "2026-08-08";

    const filterResult = eligibilityFilter(suppliers, constraints, refDate);
    const sensitivity = sensitivityReport(suppliers, constraints, refDate);

    return NextResponse.json({
      ...filterResult,
      sensitivity_report: sensitivity
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}