import { router, publicProcedure, z } from "../trpc";
import { db } from "@/db";
import { tasks, messages as msgTable, conversations } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { executeTask } from "@/lib/python";

export const taskRouter = router({
  submit: publicProcedure
    .input(z.object({ query: z.string().min(1), convId: z.string(), lang: z.string().default("en") }))
    .mutation(async ({ input }) => {
      const taskId = `task_${Date.now()}`;
      db.insert(tasks).values({
        id: taskId, conversationId: input.convId, query: input.query,
        status: "running", createdAt: new Date().toISOString(),
      }).run();
      db.insert(msgTable).values({
        conversationId: input.convId, role: "user", content: input.query, createdAt: new Date().toISOString(),
      }).run();
      db.update(conversations).set({ title: input.query.slice(0, 40) }).where(eq(conversations.id, input.convId)).run();
      executeTask(input.query, taskId, input.lang).catch(console.error);
      return { taskId, convId: input.convId };
    }),

  cancel: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input }) => {
      db.update(tasks).set({ status: "cancelled" }).where(eq(tasks.id, input.taskId)).run();
      return { ok: true };
    }),

  get: publicProcedure
    .input(z.object({ convId: z.string() }))
    .query(async ({ input }) => {
      return db.select().from(tasks).where(eq(tasks.conversationId, input.convId))
        .orderBy(desc(tasks.createdAt)).get() ?? null;
    }),
});
