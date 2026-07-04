import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { replaceContent } from "./edit-helpers.js";
import { getOptionalBooleanField, getStringField, readObject } from "./input.js";
import { resolveWorkspacePath, toPosix, writeFileWithDirs } from "./path.js";
import type { ToolRuntime } from "./types.js";

export function editTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["filePath", "oldString", "newString"], ["replaceAll"]);
  const filePath = resolveWorkspacePath(
    runtime.workspaceRoot,
    getStringField(inputObject, "filePath"),
  );
  const oldString = getStringField(inputObject, "oldString");
  const newString = getStringField(inputObject, "newString");
  const replaceAll = getOptionalBooleanField(inputObject, "replaceAll") ?? false;

  if (oldString === newString) {
    throw new Error("No changes to apply: oldString and newString are identical.");
  }

  if (oldString === "") {
    if (existsSync(filePath)) {
      throw new Error(
        "oldString cannot be empty when editing an existing file. Use write for full-file replacement.",
      );
    }

    writeFileWithDirs(filePath, newString);
    return `Created ${toPosix(relative(runtime.workspaceRoot, filePath))}.`;
  }

  const content = readFileSync(filePath, "utf8");
  const next = replaceContent(content, oldString, newString, replaceAll);
  writeFileWithDirs(filePath, next);

  return `Edited ${toPosix(relative(runtime.workspaceRoot, filePath))}.`;
}
