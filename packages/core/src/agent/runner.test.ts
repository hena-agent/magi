import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../session.js";
import { getAgent } from "./registry.js";
import { getAgentRunContinuation, runEventDrivenAgent } from "./runner.js";

describe("getAgentRunContinuation", () => {
  it("waits while any tool is pending or running", () => {
    expect(
      getAgentRunContinuation({
        events: [event(1, "user_message", { content: "read" }), settlement(2, "tool-1", "pending")],
        maxSteps: 10,
      }),
    ).toEqual({ shouldContinue: false, reason: "pending_tool_results" });

    expect(
      getAgentRunContinuation({
        events: [event(1, "user_message", { content: "read" }), settlement(2, "tool-1", "running")],
        maxSteps: 10,
      }),
    ).toEqual({ shouldContinue: false, reason: "pending_tool_results" });
  });

  it("continues after all tools settle", () => {
    expect(
      getAgentRunContinuation({
        events: [
          event(1, "user_message", { content: "read" }),
          settlement(2, "tool-1", "running"),
          settlement(3, "tool-1", "succeeded"),
        ],
        maxSteps: 10,
      }),
    ).toEqual({ shouldContinue: true, reason: "all_tools_settled" });
  });

  it("requires a final response after the step budget is exhausted", () => {
    expect(
      getAgentRunContinuation({
        events: [
          event(1, "user_message", { content: "loop" }),
          event(2, "agent_step_started", {}),
          event(3, "agent_step_started", {}),
        ],
        maxSteps: 2,
      }),
    ).toEqual({ shouldContinue: true, reason: "final_response_required" });
  });

  it("uses native tool calls before falling back to JSON actions", async () => {
    const executed: string[] = [];
    const result = await runEventDrivenAgent({
      engine: {
        async generateText() {
          return { text: JSON.stringify({ type: "finish", summary: "done" }) };
        },
        async generateStep() {
          return {
            text: "",
            toolCalls: [{ id: "tool-1", name: "read", input: { path: "README.md" } }],
          };
        },
      },
      userMessage: "Read README",
      async executeAction(action) {
        executed.push(action.type);
        return "README contents";
      },
    });

    expect(executed).toEqual(["read"]);
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("done");
  });

  it("exposes apply_patch for GPT Codex-style models", async () => {
    let tools: string[] = [];
    let stepCalls = 0;
    const result = await runEventDrivenAgent({
      engine: {
        provider: { id: "openai", provider: "openai", model: "gpt-5.5-codex" },
        async generateText() {
          return { text: JSON.stringify({ type: "finish", summary: "done" }) };
        },
        async generateStep(input) {
          stepCalls += 1;
          tools = input.tools.map((tool) => tool.name);
          if (stepCalls > 1) {
            return { text: "done", toolCalls: [] };
          }
          return {
            text: "",
            toolCalls: [
              {
                id: "tool-1",
                name: "apply_patch",
                input: { patchText: "*** Begin Patch\n*** End Patch" },
              },
            ],
          };
        },
      },
      userMessage: "Patch",
      async executeAction(action) {
        expect(action.type).toBe("apply_patch");
        return "patched";
      },
    });

    expect(tools).toContain("apply_patch");
    expect(tools).not.toContain("edit");
    expect(tools).not.toContain("write");
    expect(result.status).toBe("completed");
  });

  it("exposes edit and write for non-Codex models", async () => {
    let tools: string[] = [];
    let stepCalls = 0;
    const result = await runEventDrivenAgent({
      engine: {
        provider: { id: "claude", provider: "custom", model: "claude-sonnet-4-5" },
        async generateText() {
          return { text: JSON.stringify({ type: "finish", summary: "done" }) };
        },
        async generateStep(input) {
          stepCalls += 1;
          tools = input.tools.map((tool) => tool.name);
          if (stepCalls > 1) {
            return { text: "done", toolCalls: [] };
          }
          return {
            text: "",
            toolCalls: [
              {
                id: "tool-1",
                name: "edit",
                input: { filePath: "README.md", oldString: "old", newString: "new" },
              },
            ],
          };
        },
      },
      userMessage: "Edit",
      async executeAction(action) {
        expect(action.type).toBe("edit");
        return "edited";
      },
    });

    expect(tools).toContain("edit");
    expect(tools).toContain("write");
    expect(tools).not.toContain("apply_patch");
    expect(result.status).toBe("completed");
  });

  it("stops at a safe point when interrupted", async () => {
    const result = await runEventDrivenAgent({
      engine: {
        async generateText() {
          return { text: JSON.stringify({ type: "finish", summary: "unused" }) };
        },
      },
      userMessage: "Stop",
      shouldInterrupt() {
        return true;
      },
      async executeAction() {
        return "unused";
      },
    });

    expect(result.status).toBe("interrupted");
    expect(result.finalText).toBe("Agent run interrupted.");
  });

  it("injects plan reminders into the user prompt and filters denied plan actions", async () => {
    let capturedSystem = "";
    let capturedPrompt = "";
    const result = await runEventDrivenAgent({
      engine: {
        async generateText(input) {
          capturedSystem = input.system ?? "";
          capturedPrompt = input.prompt;

          return { text: JSON.stringify({ type: "finish", summary: "planned" }) };
        },
      },
      agent: getAgent("plan"),
      userMessage: "Plan this",
      async executeAction() {
        return "unused";
      },
    });

    expect(result.finalText).toBe("planned");
    expect(capturedSystem).not.toContain("Plan mode ACTIVE");
    expect(capturedPrompt).toContain("<system-reminder>");
    expect(capturedPrompt).toContain("Plan mode ACTIVE");
    expect(capturedPrompt).not.toContain("propose_patch");
    expect(capturedPrompt).not.toContain("verify");
  });

  it("appends OpenCode-style system context to the system prompt", async () => {
    let capturedSystem = "";

    await runEventDrivenAgent({
      engine: {
        async generateText(input) {
          capturedSystem = input.system ?? "";

          return { text: JSON.stringify({ type: "finish", summary: "done" }) };
        },
      },
      userMessage: "Use context",
      systemContext: ["<env>\n  Working directory: /tmp/repo\n</env>"],
      async executeAction() {
        return "unused";
      },
    });

    expect(capturedSystem).toContain("<env>");
    expect(capturedSystem).toContain("Working directory: /tmp/repo");
  });
});

function settlement(sequence: number, toolCallId: string, status: string): SessionEvent {
  return event(sequence, "tool_settlement", { toolCallId, name: "read", status });
}

function event(sequence: number, type: SessionEvent["type"], payload: unknown): SessionEvent {
  return {
    id: `${sequence}`,
    sessionId: "session",
    sequence,
    type,
    payload,
    createdAt: new Date(sequence).toISOString(),
  };
}
