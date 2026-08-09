import { NextResponse } from "next/server";
import { getStoreSupplierById, updateStoreSupplier, deleteStoreSupplier } from "../../../../../lib/supplier-store";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (process.env.SOURCEFIX_BACKEND_URL) {
    const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/suppliers/${id}`, { cache: "no-store" });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  }

  const supplier = getStoreSupplierById(id);
  if (!supplier) {
    return NextResponse.json({ detail: `Supplier '${id}' not found.` }, { status: 404 });
  }

  return NextResponse.json(supplier);
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const text = await request.text();
  const body = text ? JSON.parse(text) : {};

  if (process.env.SOURCEFIX_BACKEND_URL) {
    const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/suppliers/${id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  }

  const updated = updateStoreSupplier(id, body);
  if (!updated) {
    return NextResponse.json({ detail: `Supplier '${id}' not found.` }, { status: 404 });
  }

  return NextResponse.json(updated);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  if (process.env.SOURCEFIX_BACKEND_URL) {
    const res = await fetch(`${process.env.SOURCEFIX_BACKEND_URL}/api/suppliers/${id}`, {
      method: "DELETE",
      cache: "no-store",
    });
    return new Response(res.body, { status: res.status, headers: { "content-type": "application/json" } });
  }

  const deleted = deleteStoreSupplier(id);
  if (!deleted) {
    return NextResponse.json({ detail: `Supplier '${id}' not found.` }, { status: 404 });
  }

  return NextResponse.json({ status: "deleted", supplier_id: id });
}
