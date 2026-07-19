import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createToolCall, runTool } from "../tools.js";

it("runs bash asynchronously and preserves cwd output", async () => {
  const result = await runTool(
    createToolCall("bash", { command: 'node -e "console.log(process.cwd())"' }),
    { workspaceRoot: process.cwd() },
  );

  expect(result).toMatchObject({ ok: true, output: `${process.cwd()}\n` });
});

it("preserves UTF-8 characters split across output chunks", async () => {
  const result = await runTool(
    createToolCall("bash", {
      command:
        'node -e "process.stdout.write(Buffer.from([0xe2])); setTimeout(() => process.stdout.write(Buffer.from([0x82, 0xac])), 10)"',
    }),
    { workspaceRoot: process.cwd() },
  );

  expect(result).toMatchObject({ ok: true, output: "€" });
});

it("rejects caller cancellation as an AbortError", async () => {
  const controller = new AbortController();
  const operation = runTool(
    createToolCall("bash", { command: 'node -e "setTimeout(() => {}, 10000)"' }),
    { workspaceRoot: process.cwd(), signal: controller.signal },
  );

  controller.abort();

  await expect(operation).rejects.toMatchObject({ name: "AbortError" });
});

it("returns ordinary command failures as a ToolResult", async () => {
  const result = await runTool(
    createToolCall("bash", {
      command: 'node -e "setTimeout(() => {}, 10000)"',
      timeoutMs: 20,
    }),
    { workspaceRoot: process.cwd() },
  );

  expect(result).toMatchObject({ ok: false, name: "bash" });
});

it.runIf(process.platform !== "win32")(
  "terminates descendant processes when cancelled",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "magi-bash-process-group-"));
    const pidPath = join(directory, "child.pid");
    const script = [
      'const { spawn } = require("node:child_process")',
      `const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" })`,
      `require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, String(child.pid))`,
      "setInterval(() => {}, 1000)",
    ].join(";");
    const controller = new AbortController();
    const operation = runTool(
      createToolCall("bash", {
        command: `${JSON.stringify(process.execPath)} -e ${JSON.stringify(script)}`,
      }),
      { workspaceRoot: process.cwd(), signal: controller.signal },
    );

    try {
      await vi.waitFor(() => expect(existsSync(pidPath)).toBe(true));
      const childPid = Number(readFileSync(pidPath, "utf8"));
      controller.abort();
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
      await vi.waitFor(() => expect(isProcessRunning(childPid)).toBe(false), { timeout: 3_000 });
    } finally {
      controller.abort();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

function isProcessRunning(pid: number): boolean {
  try {
    const state = execFileSync("/bin/ps", ["-o", "stat=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim();
    return state.length > 0 && !state.startsWith("Z");
  } catch {
    return false;
  }
}
