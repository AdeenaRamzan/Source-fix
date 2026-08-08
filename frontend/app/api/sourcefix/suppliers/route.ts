const backendUrl = () =>
  process.env.SOURCEFIX_BACKEND_URL ?? "http://localhost:8000";

export async function GET() {
  const response = await fetch(`${backendUrl()}/api/suppliers`, {
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(request: Request) {
  const body = await request.text();
  const response = await fetch(`${backendUrl()}/api/suppliers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
