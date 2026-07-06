import { expect, it } from "vitest";
import type { SessionEvent } from "../session.js";
import { getAgentRunContinuation, runEventDrivenAgent } from "./runner.js";

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

it("does not treat older settled tools as pending after a newer assistant response", () => {
  expect(
    getAgentRunContinuation({
      events: [
        event(1, "user_message", { content: "read" }),
        settlement(2, "tool-1", "running"),
        settlement(3, "tool-1", "succeeded"),
        event(4, "assistant_message", { content: "done" }),
      ],
      maxSteps: 10,
    }),
  ).toEqual({ shouldContinue: false, reason: "completed" });
});

it("continues when queued input arrives after the latest user message", () => {
  expect(
    getAgentRunContinuation({
      events: [
        event(1, "user_message", { content: "first" }),
        event(2, "queued_user_input", { content: "second" }),
      ],
      maxSteps: 10,
    }),
  ).toEqual({ shouldContinue: true, reason: "queued_user_input" });
});

it("ignores stale queued input after a newer user message", () => {
  expect(
    getAgentRunContinuation({
      events: [
        event(1, "queued_user_input", { content: "old queued" }),
        event(2, "user_message", { content: "new" }),
      ],
      maxSteps: 10,
    }),
  ).toEqual({ shouldContinue: true, reason: "new_user_input" });
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

it("asks for a text-only final answer when max iterations are exhausted", async () => {
  const toolsPerStep: number[] = [];
  const result = await runEventDrivenAgent({
    engine: {
      async generateStep(input) {
        toolsPerStep.push(input.tools.length);

        return {
          text: "",
          toolCalls: [
            { id: `tool-${toolsPerStep.length}`, name: "read", input: { path: "README.md" } },
          ],
        };
      },
      async generateText(input) {
        expect(input.system).toContain("This is the final text-only step");

        return { text: JSON.stringify({ type: "finish", summary: "final from observations" }) };
      },
    },
    userMessage: "Loop",
    maxIterations: 1,
    async executeAction() {
      return "observation";
    },
  });

  expect(toolsPerStep).toEqual([]);
  expect(result.status).toBe("completed");
  expect(result.finalText).toBe("final from observations");
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
