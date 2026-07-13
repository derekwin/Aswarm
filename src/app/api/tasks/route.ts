import { NextResponse } from "next/server";
import { db } from "@/db";
import { tasks, messages as msgTable, conversations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { executeTask } from "@/lib/python";

export async function POST(req: Request) {
  const { query, convId, lang } = await req.json();
  if (!query || !convId) return NextResponse.json({ error: "query and convId required" }, { status: 400 });

  const taskId = `task_${Date.now()}`;
  const now = new Date().toISOString();

  db.insert(tasks).values({ id: taskId, conversationId: convId, query, status: "running", createdAt: now }).run();
  db.insert(msgTable).values({ conversationId: convId, role: "user", content: query, createdAt: now }).run();
  db.update(conversations).set({ title: query.slice(0, 40) }).where(eq(conversations.id, convId)).run();

  // Fire-and-forget
  executeTask(query, taskId, lang || "en", convId).catch(console.error);

  return NextResponse.json({ taskId, convId });
}
