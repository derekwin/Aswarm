import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: text("created_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: text("conversation_id").references(() => conversations.id).notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").references(() => conversations.id).notNull(),
  query: text("query").notNull(),
  status: text("status").notNull().default("pending"),
  intent: text("intent"),
  subtaskCount: integer("subtask_count").default(0),
  dagData: text("dag_data"),
  createdAt: text("created_at").notNull(),
});

export const agentResults = sqliteTable("agent_results", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: text("task_id").references(() => tasks.id).notNull(),
  subtaskId: text("subtask_id").notNull(),
  agentName: text("agent_name").notNull(),
  state: text("state").notNull(),
  output: text("output"),
  error: text("error"),
  retryCount: integer("retry_count").default(0),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").unique().notNull(),
  value: text("value").notNull(),
});
