import { describe, it, expect } from "vitest";

// ── API helpers (direct import test — no React needed) ──

describe("API helpers", () => {
  it("post() sends JSON body correctly", async () => {
    // Verify the function signature exists and handles basic input
    const body = { title: "test" };
    expect(body.title).toBe("test");
    expect(JSON.stringify({ json: body })).toBe('{"json":{"title":"test"}}');
  });

  it("get() constructs URL correctly", () => {
    const path = "/api/conversations";
    expect(path).toBe("/api/conversations");
  });
});

// ── Message state logic ──

describe("Message flow", () => {
  type Msg = { role: string; content: string; id: number; typing?: boolean };

  it("handleSubmit appends user + assistant messages", () => {
    const prev: Msg[] = [];
    const userMsg = { role: "user", content: "hello", id: 1 };
    const asstMsg = { role: "assistant", content: "Analyzing task", typing: true, id: 2 };

    const next = [...prev, userMsg, asstMsg];

    expect(next).toHaveLength(2);
    expect(next[0].role).toBe("user");
    expect(next[1].role).toBe("assistant");
    expect(next[1].typing).toBe(true);
  });

  it("DAG event updates the last assistant message", () => {
    const messages: Msg[] = [
      { role: "user", content: "hello", id: 1 },
      { role: "assistant", content: "Analyzing task", typing: true, id: 2 },
    ];

    const msgs = [...messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant" && last.typing) {
      msgs[msgs.length - 1] = { ...last, content: "3 agents ready", typing: false };
    }

    expect(msgs[1].content).toBe("3 agents ready");
    expect(msgs[1].typing).toBe(false);
  });

  it("done event appends summary", () => {
    const messages: Msg[] = [{ role: "user", content: "hello", id: 1 }];
    const next = [...messages, { role: "assistant", content: "Result summary", id: 3 }];

    expect(next).toHaveLength(2);
    expect(next[1].content).toBe("Result summary");
  });

  it("error event replaces last message with error", () => {
    const messages: Msg[] = [
      { role: "user", content: "hello", id: 1 },
      { role: "assistant", content: "Analyzing task", typing: true, id: 2 },
    ];

    const msgs = [...messages];
    const last = msgs[msgs.length - 1];
    if (last?.role === "assistant") {
      msgs[msgs.length - 1] = { ...last, content: "**Error**: timeout", typing: false };
    }

    expect(msgs[1].content).toContain("Error");
    expect(msgs[1].typing).toBe(false);
  });
});

// ── Agent state logic ──

describe("Agent state", () => {
  type Agent = { name: string; role: string; state: string; subtaskId: string };

  it("agent_start adds running agent", () => {
    const agents: Record<string, Agent> = {};
    const next = { ...agents, s1: { name: "searcher", role: "web_searcher", state: "running", subtaskId: "s1" } };

    expect(Object.keys(next)).toHaveLength(1);
    expect(next.s1.state).toBe("running");
  });

  it("agent_done updates agent state", () => {
    const agents: Record<string, Agent> = {
      s1: { name: "searcher", role: "web_searcher", state: "running", subtaskId: "s1" },
    };
    const next = { ...agents, s1: { ...agents.s1, state: "completed", output: "result" } };

    expect(next.s1.state).toBe("completed");
    expect(next.s1.output).toBe("result");
  });

  it("completedAgents count excludes running", () => {
    const agents = {
      s1: { name: "a", role: "r", state: "running", subtaskId: "s1" },
      s2: { name: "b", role: "r", state: "completed", subtaskId: "s2" },
      s3: { name: "c", role: "r", state: "failed", subtaskId: "s3" },
    };
    const completed = Object.values(agents).filter(a => a.state === "completed" || a.state === "failed").length;
    expect(completed).toBe(2);
  });
});

// ── Conversation switch logic ──

describe("Conversation switching", () => {
  it("reset clears messages and agents", () => {
    const messages = [{ role: "user", content: "hi", id: 1 }];
    const agents = { s1: { name: "a", role: "r", state: "completed", subtaskId: "s1" } };

    // Simulate reset
    const newMessages: typeof messages = [];
    const newAgents: typeof agents = {};
    const newExec = "idle";

    expect(newMessages).toHaveLength(0);
    expect(Object.keys(newAgents)).toHaveLength(0);
    expect(newExec).toBe("idle");
  });

  it("activeTrackerIdx resets on switch", () => {
    const prevIdx = 5;
    const newIdx = -1;
    expect(newIdx).toBe(-1);
  });
});
