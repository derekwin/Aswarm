import { NextResponse } from "next/server";
import { db } from "@/db";
import { messages } from "@/db/schema";

export async function POST(req: Request) {
  const { conversationId, role, content } = await req.json();
  db.insert(messages).values({ conversationId, role, content, createdAt: new Date().toISOString() }).run();
  return NextResponse.json({ ok: true });
}
