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

it("shows TypeScript call hierarchy through the LSP tool", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-lsp-test-"));
  mkdirSync(join(workspaceRoot, "src"));
  writeFileSync(
    join(workspaceRoot, "src", "sample.ts"),
    [
      "export function callee(): string {",
      "  return 'ok';",
      "}",
      "",
      "export function caller(): string {",
      "  return callee();",
      "}",
    ].join("\n"),
  );

  const outgoing = await runTool(
    createToolCall("lsp_call_hierarchy", {
      filePath: "src/sample.ts",
      line: 5,
      character: 17,
      direction: "outgoing",
    }),
    { workspaceRoot },
  );

  expect(outgoing.ok).toBe(true);
  expect(outgoing.output).toContain("Symbol: caller");
  expect(outgoing.output).toContain("Outgoing:");
  expect(outgoing.output).toContain("callee");

  const incoming = await runTool(
    createToolCall("lsp_call_hierarchy", {
      filePath: "src/sample.ts",
      line: 1,
      character: 17,
      direction: "incoming",
    }),
    { workspaceRoot },
  );

  expect(incoming.ok).toBe(true);
  expect(incoming.output).toContain("Symbol: callee");
  expect(incoming.output).toContain("Incoming:");
  expect(incoming.output).toContain("caller");
});
