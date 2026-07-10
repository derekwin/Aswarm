import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations, messages, tasks, agentResults } from "@/db/schema";
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
  const task = db.select({ id: tasks.id, status: tasks.status }).from(tasks).where(eq(tasks.conversationId, id)).get();
  if (task) {
    // Cancel running task on Python worker
    if (task.status === "running") {
      try { await fetch(`http://127.0.0.1:8001/cancel/${task.id}`, { method: "POST" }); } catch { /* best effort */ }
    }
    db.delete(agentResults).where(eq(agentResults.taskId, task.id)).run();
    db.delete(tasks).where(eq(tasks.conversationId, id)).run();
  }
  db.delete(messages).where(eq(messages.conversationId, id)).run();
  db.delete(conversations).where(eq(conversations.id, id)).run();
  return NextResponse.json({ ok: true });
}
