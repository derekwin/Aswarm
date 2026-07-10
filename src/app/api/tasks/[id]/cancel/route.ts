import { NextResponse } from "next/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try { await fetch(`http://127.0.0.1:8001/cancel/${id}`, { method: "POST" }); } catch { /* best effort */ }
  return NextResponse.json({ ok: true });
}
