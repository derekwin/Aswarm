import { NextResponse } from "next/server";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  const rows = db.select().from(settings).all();
  const config: Record<string, string> = {};
  for (const r of rows) config[r.key] = r.value;
  return NextResponse.json(config);
}

export async function PUT(req: Request) {
  const data = await req.json();
  for (const [key, value] of Object.entries(data)) {
    const existing = db.select().from(settings).where(eq(settings.key, key)).get();
    if (existing) {
      db.update(settings).set({ value: String(value) }).where(eq(settings.key, key)).run();
    } else {
      db.insert(settings).values({ key, value: String(value) }).run();
    }
  }
  return NextResponse.json({ ok: true });
}
