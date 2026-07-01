import { describe, expect, it } from "vitest";
import { runAgentTurn } from "./turn.js";

describe("runAgentTurn", () => {
  it("runs executable actions until finish", async () => {
    const responses = [
      JSON.stringify({ type: "read", path: "README.md" }),
      JSON.stringify({ type: "finish", summary: "Read README and finished." }),
    ];
    const executed: string[] = [];
    const result = await runAgentTurn({
      engine: {
        async generateText() {
          return { text: responses.shift() ?? JSON.stringify({ type: "finish", summary: "done" }) };
        },
      },
      userMessage: "Read the README",
      async executeAction(action) {
        executed.push(action.type);
        return "README contents";
      },
    });

    expect(executed).toEqual(["read"]);
    expect(result.status).toBe("completed");
    expect(result.finalText).toBe("Read README and finished.");
  });

  it("returns a useful summary when reaching max iterations", async () => {
    let calls = 0;
    const result = await runAgentTurn({
      engine: {
        async generateText() {
          calls += 1;
          if (calls === 3) {
            return { text: JSON.stringify({ type: "finish", summary: "Final text-only answer." }) };
          }

          return { text: JSON.stringify({ type: "glob", pattern: "**/*.ts" }) };
        },
      },
      userMessage: "Loop",
      maxIterations: 2,
      async executeAction() {
        return "files";
      },
    });

    expect(result.status).toBe("max_iterations");
    expect(result.finalText).toBe("Final text-only answer.");
    expect(result.steps).toHaveLength(2);
  });

  it("skips repeated executable actions", async () => {
    const responses = [
      JSON.stringify({ type: "read", path: "README.md" }),
      JSON.stringify({ type: "read", path: "README.md" }),
      JSON.stringify({ type: "finish", summary: "Finished from prior observation." }),
    ];
    const executed: string[] = [];
    const result = await runAgentTurn({
      engine: {
        async generateText() {
          return { text: responses.shift() ?? JSON.stringify({ type: "finish", summary: "done" }) };
        },
      },
      userMessage: "Read README twice",
      async executeAction(action) {
        executed.push(action.type);
        return "README contents";
      },
    });

    expect(executed).toEqual(["read"]);
    expect(result.status).toBe("completed");
    expect(result.steps[1]?.observation).toMatch(/Repeated action skipped/);
  });

  it("emits lifecycle and provider error events", async () => {
    const events: string[] = [];

    await expect(
      runAgentTurn({
        engine: {
          async generateText() {
            throw new Error("provider down");
          },
        },
        userMessage: "Fail",
        onEvent(event) {
          events.push(event.type);
        },
        async executeAction() {
          return "unused";
        },
      }),
    ).rejects.toThrow(/provider down/);

    expect(events).toEqual([
      "agent_step_started",
      "assistant_started",
      "provider_error",
      "agent_step_ended",
    ]);
  });
});
