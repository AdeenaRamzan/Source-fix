import { Constraint } from "../../../../../lib/backend-core";
import { runAgentStream } from "../../../../../lib/agent-core";
import { getStoreSuppliers } from "../../../../../lib/supplier-store";

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
  const text = await request.text();
  const body = text ? JSON.parse(text) : {};

  if (process.env.SOURCEFIX_BACKEND_URL) {
    const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/analyze/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": "text/event-stream" } });
  }

  const suppliers = body.suppliers || getStoreSuppliers();
  const constraints = body.constraints || defaultConstraints;
  const maxIterations = body.max_iterations || 5;
  const refDate = body.reference_date || "2026-08-08";

  const encoder = new TextEncoder();

  const customReadable = new ReadableStream({
    async start(controller) {
      try {
        for await (const step of runAgentStream(suppliers, constraints, maxIterations, refDate)) {
          const payload = {
            node: step.node,
            status: step.complete ? "complete" : "running",
            output: step.state,
          };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        }
      } catch (err: any) {
        const errorPayload = {
          node: "error",
          status: "error",
          payload: { error: err.message || "Agent execution failed." },
        };
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorPayload)}\n\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(customReadable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}