import { readFileSync } from "node:fs";
import { getStringField, readObject } from "./input.js";
import { resolveWorkspacePath } from "./path.js";
import type { ToolRuntime } from "./types.js";

export function readTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["path"]);
  const path = getStringField(inputObject, "path");
  const filePath = resolveWorkspacePath(runtime.workspaceRoot, path);

  return readFileSync(filePath, "utf8");
}
