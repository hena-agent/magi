import { relative } from "node:path";
import { getStringField, readObject } from "./input.js";
import { resolveWorkspacePath, toPosix, writeFileWithDirs } from "./path.js";
import type { ToolRuntime } from "./types.js";

export function writeTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["filePath", "content"]);
  const filePath = resolveWorkspacePath(
    runtime.workspaceRoot,
    getStringField(inputObject, "filePath"),
  );
  writeFileWithDirs(filePath, getStringField(inputObject, "content"));

  return `Wrote ${toPosix(relative(runtime.workspaceRoot, filePath))}.`;
}
