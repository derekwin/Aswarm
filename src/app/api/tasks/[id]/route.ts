import { NextResponse } from "next/server";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function PUT(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { status } = await _req.json();
  db.update(tasks).set({ status }).where(eq(tasks.id, id)).run();
  return NextResponse.json({ ok: true });
}
