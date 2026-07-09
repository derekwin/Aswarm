import { router, publicProcedure, z } from "../trpc";
import { prisma } from "@/lib/prisma";

export const convRouter = router({
  list: publicProcedure.query(async () => {
    const convs = await prisma.conversation.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true },
    });
    return convs;
  }),

  create: publicProcedure
    .input(z.object({ title: z.string().default("New Task") }))
    .mutation(async ({ input }) => {
      const id = `conv_${Date.now()}`;
      const conv = await prisma.conversation.create({
        data: { id, title: input.title },
      });
      return conv;
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const conv = await prisma.conversation.findUnique({
        where: { id: input.id },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!conv) throw new Error("Conversation not found");
      return conv;
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      await prisma.conversation.delete({ where: { id: input.id } });
      return { ok: true };
    }),
});
