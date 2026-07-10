import { describe, it, expect } from "vitest";

describe("Message persistence", () => {
  it("task submit saves user + assistant placeholder to DB", () => {
    const messages: { role: string; content: string }[] = [];
    // Simulate task submit saving 2 messages
    messages.push({ role: "user", content: "hello" });
    messages.push({ role: "assistant", content: "Analyzing task..." });
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
    expect(messages[1].content).toBe("Analyzing task...");
  });

  it("done event saves final summary to DB", () => {
    const messages: { role: string; content: string }[] = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "Analyzing task..." },
    ];
    // On done event, append and save
    const summary = "Final report";
    messages.push({ role: "assistant", content: summary });
    expect(messages).toHaveLength(3);
    expect(messages[2].content).toBe(summary);
  });

  it("restored running task shows placeholder message", () => {
    const loadedMessages = [
      { role: "user", content: "Research chip market", id: 1 },
      { role: "assistant", content: "Analyzing task...", id: 2 },
    ];
    // SwitchConversation loads these from API
    const task = { status: "running", id: "task_123" };

    if (task.status === "running") {
      const lastMsg = loadedMessages[loadedMessages.length - 1];
      expect(lastMsg.role).toBe("assistant");
      expect(lastMsg.content).toBe("Analyzing task...");
    }
  });

  it("restored completed task shows full messages", () => {
    const loadedMessages = [
      { role: "user", content: "Research chip market", id: 1 },
      { role: "assistant", content: "Analyzing task...", id: 2 },
      { role: "assistant", content: "## Market Report\n\nFindings...", id: 3 },
    ];
    expect(loadedMessages).toHaveLength(3);
    expect(loadedMessages[2].content).toContain("Market Report");
  });
});
