import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, tasks } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const conv = db.select().from(conversations).where(eq(conversations.id, id)).get();
  if (!conv) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const msgs = db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(messages.createdAt).all();
  const task = db.select().from(tasks).where(eq(tasks.conversationId, id)).orderBy(desc(tasks.createdAt)).get();
  return NextResponse.json({ ...conv, messages: msgs, task: task || null });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  db.delete(conversations).where(eq(conversations.id, id)).run();
  return NextResponse.json({ ok: true });
}
