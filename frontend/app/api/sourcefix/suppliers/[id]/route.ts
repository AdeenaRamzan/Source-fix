const backendUrl = () =>
  process.env.SOURCEFIX_BACKEND_URL ?? "http://localhost:8000";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const response = await fetch(`${backendUrl()}/api/suppliers/${id}`, {
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.text();
  const response = await fetch(`${backendUrl()}/api/suppliers/${id}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body,
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const response = await fetch(`${backendUrl()}/api/suppliers/${id}`, {
    method: "DELETE",
    cache: "no-store",
  });
  return new Response(response.body, {
    status: response.status,
    headers: { "content-type": "application/json" },
  });
}
