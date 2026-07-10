import { NextResponse } from "next/server";
import { db } from "@/db";
import { conversations } from "@/db/schema";
import { desc } from "drizzle-orm";

export async function GET() {
  const convs = db.select().from(conversations).orderBy(desc(conversations.createdAt)).all();
  return NextResponse.json(convs);
}

export async function POST(req: Request) {
  const { title } = await req.json();
  const id = `conv_${Date.now()}`;
  db.insert(conversations).values({ id, title: title || "New Task", createdAt: new Date().toISOString() }).run();
  return NextResponse.json({ id, title: title || "New Task" });
}
