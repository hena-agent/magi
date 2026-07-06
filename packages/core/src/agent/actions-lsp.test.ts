import { expect, it } from "vitest";
import { agentActionToToolName, validateAgentAction } from "./actions.js";

it("validates LSP actions", () => {
  expect(validateAgentAction({ type: "lsp_symbols", filePath: "src/index.ts" })).toEqual({
    type: "lsp_symbols",
    filePath: "src/index.ts",
  });
  expect(
    validateAgentAction({
      type: "lsp_definition",
      filePath: "src/index.ts",
      line: 1,
      character: 1,
    }),
  ).toEqual({
    type: "lsp_definition",
    filePath: "src/index.ts",
    line: 1,
    character: 1,
  });
  expect(() =>
    validateAgentAction({
      type: "lsp_hover",
      filePath: "src/index.ts",
      line: 0,
      character: 1,
    }),
  ).toThrow(/positive integer/);
  expect(
    validateAgentAction({
      type: "lsp_call_hierarchy",
      filePath: "src/index.ts",
      line: 1,
      character: 1,
      direction: "incoming",
    }),
  ).toEqual({
    type: "lsp_call_hierarchy",
    filePath: "src/index.ts",
    line: 1,
    character: 1,
    direction: "incoming",
  });
  expect(() =>
    validateAgentAction({
      type: "lsp_call_hierarchy",
      filePath: "src/index.ts",
      line: 1,
      character: 1,
      direction: "sideways",
    }),
  ).toThrow(/direction/);
});

it("maps LSP actions to tool names", () => {
  expect(agentActionToToolName({ type: "lsp_symbols", filePath: "src/index.ts" })).toBe(
    "lsp_symbols",
  );
  expect(
    agentActionToToolName({
      type: "lsp_hover",
      filePath: "src/index.ts",
      line: 1,
      character: 1,
    }),
  ).toBe("lsp_hover");
  expect(
    agentActionToToolName({
      type: "lsp_call_hierarchy",
      filePath: "src/index.ts",
      line: 1,
      character: 1,
    }),
  ).toBe("lsp_call_hierarchy");
});
