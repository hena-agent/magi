import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createToolCall, getToolPermission, runTool } from "./tools.js";

describe("tools", () => {
  it("runs read, glob, and grep tools", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tools-test-"));
    writeFileSync(join(workspaceRoot, "alpha.txt"), "hello magi\n");

    await expect(
      runTool(createToolCall("read", { path: "alpha.txt" }), { workspaceRoot }),
    ).resolves.toMatchObject({ ok: true, output: "hello magi\n" });
    await expect(
      runTool(createToolCall("glob", { pattern: "*.txt" }), { workspaceRoot }),
    ).resolves.toMatchObject({ ok: true, output: "alpha.txt" });
    await expect(
      runTool(createToolCall("grep", { pattern: "magi", include: "*.txt" }), { workspaceRoot }),
    ).resolves.toMatchObject({ ok: true, output: "alpha.txt:1: hello magi" });
  });

  it("rejects paths outside the workspace", async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tools-test-"));
    const result = await runTool(createToolCall("read", { path: "../outside.txt" }), {
      workspaceRoot,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escapes workspace/);
  });

  it("maps permissions for tool names", () => {
    expect(getToolPermission("read")).toBe("read");
    expect(getToolPermission("apply_patch")).toBe("write");
    expect(getToolPermission("bash")).toBe("shell");
  });
});
