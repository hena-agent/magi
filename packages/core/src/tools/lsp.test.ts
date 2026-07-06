import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createToolCall, runTool } from "../tools.js";

it("lists TypeScript document symbols through the LSP tool", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-lsp-test-"));
  mkdirSync(join(workspaceRoot, "src"));
  writeFileSync(
    join(workspaceRoot, "src", "sample.ts"),
    [
      "export function greet(name: string): string {",
      "  return name;",
      "}",
      "",
      "export const answer = 42;",
    ].join("\n"),
  );

  const result = await runTool(createToolCall("lsp_symbols", { filePath: "src/sample.ts" }), {
    workspaceRoot,
  });

  expect(result.ok).toBe(true);
  expect(result.output).toContain("greet");
  expect(result.output).toContain("answer");
});
