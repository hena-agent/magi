import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createToolCall, createToolSettlement, getToolPermission, runTool } from "./tools.js";

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

  it("creates durable settlement records", () => {
    const call = createToolCall("read", { path: "README.md" });
    const settlement = createToolSettlement({
      call,
      status: "succeeded",
      result: { id: call.id, name: call.name, ok: true, output: "a".repeat(3_000) },
    });

    expect(settlement).toMatchObject({
      toolCallId: call.id,
      name: "read",
      status: "succeeded",
      input: { path: "README.md" },
    });
    expect(settlement.outputPreview?.length).toBeLessThan(3_000);
  });
});
