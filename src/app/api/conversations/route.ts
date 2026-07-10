import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { desc } from "drizzle-orm";
import { mkdirSync } from "fs";
import { join } from "path";

const DATA_DIR = process.env.AGENTSWARM_DATA_DIR || "data";

export async function GET() {
  const convs = db.select().from(conversations).orderBy(desc(conversations.createdAt)).all();
  return NextResponse.json(convs);
}

export async function POST(req: Request) {
  const { title } = await req.json();
  const id = `conv_${Date.now()}`;
  db.insert(conversations).values({ id, title: title || "New Task", createdAt: new Date().toISOString() }).run();
  // Create workspace directory for this conversation
  try { mkdirSync(join(DATA_DIR, "workspaces", id), { recursive: true }); } catch { /* */ }
  return NextResponse.json({ id, title: title || "New Task" });
}
