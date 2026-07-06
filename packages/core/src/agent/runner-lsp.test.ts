import { expect, it } from "vitest";
import { runEventDrivenAgent } from "./runner.js";

it("exposes LSP tools as read native tools", async () => {
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
    userMessage: "Use LSP",
    async executeAction() {
      return "unused";
    },
  });

  expect(tools).toContain("lsp_symbols");
  expect(tools).toContain("lsp_definition");
  expect(tools).toContain("lsp_references");
  expect(tools).toContain("lsp_hover");
});
