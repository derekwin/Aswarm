import { router } from "./trpc";
import { convRouter } from "./routers/conversation";
import { taskRouter } from "./routers/task";

export const appRouter = router({
  conversation: convRouter,
  task: taskRouter,
});

export type AppRouter = typeof appRouter;
