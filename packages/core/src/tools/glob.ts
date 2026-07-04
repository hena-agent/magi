import { relative } from "node:path";
import { createGlobMatcher, listFiles } from "./discovery.js";
import { getStringField, readObject } from "./input.js";
import { toPosix } from "./path.js";
import type { ToolRuntime } from "./types.js";

export function globTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["pattern"]);
  const pattern = getStringField(inputObject, "pattern");
  const matcher = createGlobMatcher(pattern);

  return listFiles(runtime.workspaceRoot)
    .filter((filePath) => matcher(toPosix(relative(runtime.workspaceRoot, filePath))))
    .map((filePath) => toPosix(relative(runtime.workspaceRoot, filePath)))
    .join("\n");
}
