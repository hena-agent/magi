import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createToolCall, createToolSettlement, getToolPermission, runTool } from "./tools.js";

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

it("runs edit and write tools", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tools-test-"));
  writeFileSync(join(workspaceRoot, "alpha.txt"), "one\ntwo\n");

  await expect(
    runTool(
      createToolCall("edit", {
        filePath: "alpha.txt",
        oldString: "two",
        newString: "three",
      }),
      { workspaceRoot },
    ),
  ).resolves.toMatchObject({ ok: true, output: "Edited alpha.txt." });
  expect(readFileSync(join(workspaceRoot, "alpha.txt"), "utf8")).toBe("one\nthree\n");

  await expect(
    runTool(createToolCall("write", { filePath: "nested/beta.txt", content: "created" }), {
      workspaceRoot,
    }),
  ).resolves.toMatchObject({ ok: true, output: "Wrote nested/beta.txt." });
  expect(readFileSync(join(workspaceRoot, "nested", "beta.txt"), "utf8")).toBe("created");
});

it("supports replaceAll and preserves CRLF with edit", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tools-test-"));
  writeFileSync(join(workspaceRoot, "alpha.txt"), "one\r\ntwo\r\ntwo\r\n");

  const result = await runTool(
    createToolCall("edit", {
      filePath: "alpha.txt",
      oldString: "two",
      newString: "three",
      replaceAll: true,
    }),
    { workspaceRoot },
  );

  expect(result.ok).toBe(true);
  expect(readFileSync(join(workspaceRoot, "alpha.txt"), "utf8")).toBe("one\r\nthree\r\nthree\r\n");
});

it("rejects ambiguous edit matches unless replaceAll is true", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tools-test-"));
  writeFileSync(join(workspaceRoot, "alpha.txt"), "same\nsame\n");

  const result = await runTool(
    createToolCall("edit", { filePath: "alpha.txt", oldString: "same", newString: "next" }),
    { workspaceRoot },
  );

  expect(result.ok).toBe(false);
  expect(result.error).toMatch(/multiple matches/);
  expect(readFileSync(join(workspaceRoot, "alpha.txt"), "utf8")).toBe("same\nsame\n");
});

it("applies OpenCode-style apply_patch envelopes", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tools-test-"));
  writeFileSync(join(workspaceRoot, "modify.txt"), "line1\nline2\n");
  writeFileSync(join(workspaceRoot, "delete.txt"), "obsolete\n");

  const result = await runTool(
    createToolCall("apply_patch", {
      patchText: [
        "*** Begin Patch",
        "*** Add File: nested/new.txt",
        "+created",
        "*** Delete File: delete.txt",
        "*** Update File: modify.txt",
        "@@",
        "-line2",
        "+changed",
        "*** End Patch",
      ].join("\n"),
    }),
    { workspaceRoot },
  );

  expect(result.ok).toBe(true);
  expect(result.output).toContain("A nested/new.txt");
  expect(result.output).toContain("D delete.txt");
  expect(result.output).toContain("M modify.txt");
  expect(readFileSync(join(workspaceRoot, "nested", "new.txt"), "utf8")).toBe("created\n");
  expect(readFileSync(join(workspaceRoot, "modify.txt"), "utf8")).toBe("line1\nchanged\n");
  expect(existsSync(join(workspaceRoot, "delete.txt"))).toBe(false);
});

it("maps permissions for tool names", () => {
  expect(getToolPermission("read")).toBe("read");
  expect(getToolPermission("edit")).toBe("write");
  expect(getToolPermission("write")).toBe("write");
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
