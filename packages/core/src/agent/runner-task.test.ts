import { expect, it } from "vitest";
import { runEventDrivenAgent } from "./runner.js";

it("preserves background task flag from native tool calls", async () => {
  const actions: unknown[] = [];
  let stepCalls = 0;
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls > 1) return { text: "", toolCalls: [] };

        return {
          text: "",
          toolCalls: [
            {
              id: "tool-1",
              name: "task",
              input: {
                description: "Explore docs",
                prompt: "Read docs",
                subagent_type: "explore",
                background: true,
              },
            },
          ],
        };
      },
    },
    userMessage: "Launch background task",
    async executeAction(action) {
      actions.push(action);
      return "task started";
    },
  });

  expect(actions).toEqual([
    {
      type: "task",
      description: "Explore docs",
      prompt: "Read docs",
      subagent_type: "explore",
      background: true,
    },
  ]);
  expect(result.status).toBe("completed");
});
