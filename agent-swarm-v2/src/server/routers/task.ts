import { router, publicProcedure, z } from "../trpc";
import { prisma } from "@/lib/prisma";
import { decompose, executeTask, cancelTask as pyCancel } from "@/lib/python";

export const taskRouter = router({
  submit: publicProcedure
    .input(z.object({ query: z.string().min(1), convId: z.string(), lang: z.string().default("en") }))
    .mutation(async ({ input }) => {
      const taskId = `task_${Date.now()}`;

      // Create task in DB
      await prisma.task.create({
        data: {
          id: taskId,
          conversationId: input.convId,
          query: input.query,
          status: "running",
        },
      });

      // Add user message
      await prisma.message.create({
        data: {
          conversationId: input.convId,
          role: "user",
          content: input.query,
        },
      });

      // Update conversation title
      await prisma.conversation.update({
        where: { id: input.convId },
        data: { title: input.query.slice(0, 40) },
      });

      // Fire-and-forget: Python worker executes in background
      executeTask(input.query, taskId, input.lang).catch(console.error);

      return { taskId, convId: input.convId };
    }),

  cancel: publicProcedure
    .input(z.object({ taskId: z.string() }))
    .mutation(async ({ input }) => {
      await pyCancel(input.taskId);
      await prisma.task.update({
        where: { id: input.taskId },
        data: { status: "cancelled" },
      });
      return { ok: true };
    }),

  get: publicProcedure
    .input(z.object({ convId: z.string() }))
    .query(async ({ input }) => {
      const task = await prisma.task.findFirst({
        where: { conversationId: input.convId },
        orderBy: { createdAt: "desc" },
        include: { agentResults: true },
      });
      return task;
    }),
});
