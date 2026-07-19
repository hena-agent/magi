import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOptionalStringField, readObject } from "./input.js";
import { applyMagiPatch, looksLikeMagiPatch } from "./patch.js";
import { resolveWorkspacePath } from "./path.js";
import type { ToolRuntime } from "./types.js";

export function applyPatchTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, [], ["patch", "patchText", "patchFile"]);
  const patch =
    getOptionalStringField(inputObject, "patch") ??
    getOptionalStringField(inputObject, "patchText");
  const patchFile = getOptionalStringField(inputObject, "patchFile");
  const patchText =
    typeof patch === "string"
      ? patch
      : typeof patchFile === "string"
        ? readFileSync(resolveWorkspacePath(runtime.workspaceRoot, patchFile), "utf8")
        : undefined;

  if (!patchText) {
    throw new Error("apply_patch requires patch, patchText, or patchFile.");
  }

  if (looksLikeMagiPatch(patchText)) {
    return applyMagiPatch(patchText, runtime);
  }

  const tempDirectory = mkdtempSync(join(tmpdir(), "magi-patch-"));
  const patchPath = join(tempDirectory, "change.patch");

  try {
    writeFileSync(patchPath, patchText);
    execFileSync("git", ["apply", patchPath], {
      cwd: runtime.workspaceRoot,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 5,
    });

    return "Patch applied.";
  } finally {
    rmSync(tempDirectory, { force: true, recursive: true });
  }
}
