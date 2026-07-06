import { expect, it } from "vitest";
import { getAgent } from "./registry.js";
import { runEventDrivenAgent } from "./runner.js";

it("exposes websearch as a network native tool", async () => {
  let tools: string[] = [];

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep(input) {
        tools = input.tools.map((tool) => tool.name);
        return { text: "done", toolCalls: [] };
      },
    },
    userMessage: "Search web",
    async executeAction() {
      return "unused";
    },
  });

  expect(tools).toContain("websearch");
});

it("hides websearch from the plan agent", async () => {
  let tools: string[] = [];

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep(input) {
        tools = input.tools.map((tool) => tool.name);
        return { text: "done", toolCalls: [] };
      },
    },
    agent: getAgent("plan"),
    userMessage: "Plan",
    async executeAction() {
      return "unused";
    },
  });

  expect(tools).not.toContain("websearch");
});
