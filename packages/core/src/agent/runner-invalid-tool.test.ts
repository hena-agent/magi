import { expect, it } from "vitest";
import { runEventDrivenAgent } from "./runner.js";

it("reports unknown native tool calls as invalid tool observations", async () => {
  const executed: string[] = [];
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "recovered" }) };
      },
      async generateStep() {
        return {
          text: "",
          toolCalls: [{ id: "tool-1", name: "unknown_tool", input: { path: "README.md" } }],
        };
      },
    },
    userMessage: "Use an unknown tool",
    async executeAction(action) {
      executed.push(action.type);
      return "unused";
    },
  });

  expect(executed).toEqual([]);
  expect(result.steps[0]?.action).toMatchObject({
    type: "invalid_tool",
    toolName: "unknown_tool",
  });
  expect(result.steps[0]?.observation).toContain("Unsupported native tool name: unknown_tool");
  expect(result.status).toBe("completed");
  expect(result.finalText).toBe("recovered");
});

it("reports malformed native tool inputs as invalid tool observations", async () => {
  const executed: string[] = [];
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "recovered" }) };
      },
      async generateStep() {
        return {
          text: "",
          toolCalls: [{ id: "tool-1", name: "read", input: { path: 123 } }],
        };
      },
    },
    userMessage: "Use malformed input",
    async executeAction(action) {
      executed.push(action.type);
      return "unused";
    },
  });

  expect(executed).toEqual([]);
  expect(result.steps[0]?.action).toMatchObject({ type: "invalid_tool", toolName: "read" });
  expect(result.steps[0]?.observation).toContain("Native tool input requires string field: path");
  expect(result.status).toBe("completed");
  expect(result.finalText).toBe("recovered");
});
