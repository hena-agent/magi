import { readFileSync, unlinkSync } from "node:fs";
import { relative } from "node:path";
import { resolveWorkspacePath, toPosix, writeFileWithDirs } from "./path.js";
import { parseMagiPatch } from "./patch-parser.js";
import type { PatchHunk } from "./patch-types.js";
import { deriveUpdatedContents } from "./patch-update.js";
import type { ToolRuntime } from "./types.js";

export function looksLikeMagiPatch(patchText: string): boolean {
  return patchText.includes("*** Begin Patch") || patchText.includes("*** End Patch");
}

export function applyMagiPatch(patchText: string, runtime: ToolRuntime): string {
  const hunks = parseMagiPatch(patchText);

  if (hunks.length === 0) {
    throw new Error("apply_patch verification failed: no hunks found");
  }

  const changes = hunks.map((hunk) => derivePatchChange(hunk, runtime));

  for (const change of changes) {
    switch (change.type) {
      case "add":
      case "update":
        writeFileWithDirs(change.path, change.contents);
        break;
      case "delete":
        unlinkSync(change.path);
        break;
      case "move":
        writeFileWithDirs(change.movePath, change.contents);
        unlinkSync(change.path);
        break;
    }
  }

  return [
    "Success. Updated the following files:",
    ...changes.map((change) => {
      if (change.type === "add")
        return `A ${toPosix(relative(runtime.workspaceRoot, change.path))}`;
      if (change.type === "delete")
        return `D ${toPosix(relative(runtime.workspaceRoot, change.path))}`;
      const target = change.type === "move" ? change.movePath : change.path;
      return `M ${toPosix(relative(runtime.workspaceRoot, target))}`;
    }),
  ].join("\n");
}

function derivePatchChange(
  hunk: PatchHunk,
  runtime: ToolRuntime,
):
  | { type: "add"; path: string; contents: string }
  | { type: "delete"; path: string }
  | { type: "update"; path: string; contents: string }
  | { type: "move"; path: string; movePath: string; contents: string } {
  const filePath = resolveWorkspacePath(runtime.workspaceRoot, hunk.path);

  switch (hunk.type) {
    case "add":
      return { type: "add", path: filePath, contents: ensureTrailingNewline(hunk.contents) };
    case "delete":
      readFileSync(filePath, "utf8");
      return { type: "delete", path: filePath };
    case "update": {
      const original = readFileSync(filePath, "utf8");
      const contents = deriveUpdatedContents(original, hunk.chunks, hunk.path);

      if (hunk.movePath) {
        return {
          type: "move",
          path: filePath,
          movePath: resolveWorkspacePath(runtime.workspaceRoot, hunk.movePath),
          contents,
        };
      }

      return { type: "update", path: filePath, contents };
    }
  }
}

function ensureTrailingNewline(value: string): string {
  return value.length === 0 || value.endsWith("\n") ? value : `${value}\n`;
}
