import { NextResponse } from "next/server";
import { getStoreSuppliers, addStoreSupplier } from "../../../../lib/supplier-store";

export async function GET() {
  if (process.env.SOURCEFIX_BACKEND_URL) {
    const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/suppliers`, { cache: "no-store" });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  }

  return NextResponse.json(getStoreSuppliers());
}

export async function POST(request: Request) {
  const text = await request.text();
  const body = text ? JSON.parse(text) : {};

  if (process.env.SOURCEFIX_BACKEND_URL) {
    const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/suppliers`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  }

  try {
    const created = addStoreSupplier(body);
    return NextResponse.json(created, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ detail: err.message }, { status: err.message?.includes("already exists") ? 409 : 422 });
  }
}
