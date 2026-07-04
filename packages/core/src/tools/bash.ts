import { execSync } from "node:child_process";
import { getStringField, readObject } from "./input.js";
import type { ToolRuntime } from "./types.js";

export function bashTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["command"], ["timeoutMs"]);
  const command = getStringField(inputObject, "command");
  const timeoutMs = inputObject.timeoutMs;

  return execSync(command, {
    cwd: runtime.workspaceRoot,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 5,
    timeout: typeof timeoutMs === "number" ? timeoutMs : 120_000,
  });
}
