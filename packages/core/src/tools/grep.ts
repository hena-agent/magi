import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { createGlobMatcher, listFiles } from "./discovery.js";
import { getOptionalStringField, getStringField, readObject } from "./input.js";
import { toPosix } from "./path.js";
import type { ToolRuntime } from "./types.js";

export function grepTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["pattern"], ["include"]);
  const pattern = getStringField(inputObject, "pattern");
  const include = getOptionalStringField(inputObject, "include");
  const regex = new RegExp(pattern, "i");
  const includeMatcher = typeof include === "string" ? createGlobMatcher(include) : undefined;
  const matches: string[] = [];

  for (const filePath of listFiles(runtime.workspaceRoot)) {
    const relativePath = toPosix(relative(runtime.workspaceRoot, filePath));

    if (includeMatcher && !includeMatcher(relativePath)) {
      continue;
    }

    const lines = readFileSync(filePath, "utf8").split("\n");

    lines.forEach((line, index) => {
      if (regex.test(line)) {
        matches.push(`${relativePath}:${index + 1}: ${line}`);
      }
    });
  }

  return matches.join("\n");
}
