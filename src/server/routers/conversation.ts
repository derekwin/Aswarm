import { router, publicProcedure, z } from "../trpc";
import { db } from "@/db";
import { conversations, messages } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export const convRouter = router({
  list: publicProcedure.query(async () => {
    return db.select({ id: conversations.id, title: conversations.title, createdAt: conversations.createdAt })
      .from(conversations).orderBy(desc(conversations.createdAt)).all();
  }),

  create: publicProcedure
    .input(z.object({ title: z.string().default("New Task") }))
    .mutation(async ({ input }) => {
      const id = `conv_${Date.now()}`;
      db.insert(conversations).values({ id, title: input.title, createdAt: new Date().toISOString() }).run();
      return { id, title: input.title };
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const conv = db.select().from(conversations).where(eq(conversations.id, input.id)).get();
      if (!conv) throw new Error("Conversation not found");
      const msgs = db.select().from(messages).where(eq(messages.conversationId, input.id)).orderBy(messages.createdAt).all();
      return { ...conv, messages: msgs };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      db.delete(conversations).where(eq(conversations.id, input.id)).run();
      return { ok: true };
    }),
});
