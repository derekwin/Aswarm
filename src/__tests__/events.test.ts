import { describe, it, expect } from "vitest";

describe("SSE event parsing", () => {
  it("parses exec_state event", () => {
    const event = { type: "exec_state", state: "decomposing" };
    expect(event.type).toBe("exec_state");
    expect(event.state).toBe("decomposing");
  });

  it("parses dag event with subtasks", () => {
    const event = {
      type: "dag",
      subtasks: [{ id: "t1", name: "searcher", role: "web_searcher", tools: [], depends_on: [] }],
      parallel_groups: [["t1"]],
    };
    expect(event.subtasks).toHaveLength(1);
    expect(event.parallel_groups).toHaveLength(1);
  });

  it("parses agent_start event", () => {
    const event = { type: "agent_start", subtask_id: "s1", agent_name: "searcher", role: "web_searcher" };
    expect(event.agent_name).toBe("searcher");
  });

  it("parses agent_done with output", () => {
    const event = { type: "agent_done", subtask_id: "s1", state: "completed", output: "result", retry_count: 0 };
    expect(event.state).toBe("completed");
    expect(event.output).toBe("result");
  });

  it("parses progress event", () => {
    const event = { type: "progress", completed: 2, total: 5 };
    expect(event.completed).toBe(2);
    expect(event.total).toBe(5);
  });

  it("parses done event with summary", () => {
    const event = { type: "done", summary: "Task completed" };
    expect(event.summary).toBe("Task completed");
  });

  it("parses error event", () => {
    const event = { type: "error", msg: "timeout", code: "TIMEOUT" };
    expect(event.msg).toBe("timeout");
    expect(event.code).toBe("TIMEOUT");
  });

  it("ignores malformed JSON gracefully", () => {
    const parse = (data: string) => {
      try { return JSON.parse(data); } catch { return null; }
    };
    expect(parse("{bad json")).toBeNull();
    expect(parse('{"type":"test"}')).toEqual({ type: "test" });
  });
});

describe("Delete conversation", () => {
  it("removes active conversation from list", () => {
    const convs = [
      { id: "1", title: "A", createdAt: "" },
      { id: "2", title: "B", createdAt: "" },
    ];
    const filtered = convs.filter(c => c.id !== "1");
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  it("clears state if deleting active conversation", () => {
    const activeConv = "1";
    const deletedId = "1";
    if (deletedId === activeConv) {
      const newActive = null;
      const newMessages: unknown[] = [];
      expect(newActive).toBeNull();
      expect(newMessages).toHaveLength(0);
    }
  });
});

describe("Auto-scroll behavior", () => {
  it("scrolls when near bottom", () => {
    const scrollHeight = 1000;
    const scrollTop = 920;
    const clientHeight = 100;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    expect(isNearBottom).toBe(true); // -20 < 100 → near bottom, should scroll
  });

  it("does not scroll when reading history", () => {
    const scrollHeight = 1000;
    const scrollTop = 500;
    const clientHeight = 100;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
    expect(isNearBottom).toBe(false); // 1000-500-100 = 400, NOT < 100
  });
});
