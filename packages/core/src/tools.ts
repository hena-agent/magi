import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";

export type ToolName = "read" | "glob" | "grep" | "apply_patch" | "bash";

export type ToolPermission = "read" | "write" | "shell";

export type ToolCall = {
  id: string;
  name: ToolName;
  input: unknown;
};

export type ToolResult = {
  id: string;
  name: ToolName;
  ok: boolean;
  output: string;
  error?: string;
};

export type ToolSettlementStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "denied"
  | "interrupted";

export type ToolSettlement = {
  toolCallId: string;
  name: ToolName;
  status: ToolSettlementStatus;
  input?: unknown;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  outputPreview?: string;
  error?: string;
};

type ToolRuntime = {
  workspaceRoot: string;
};

export function getToolPermission(toolName: ToolName): ToolPermission {
  if (toolName === "bash") {
    return "shell";
  }

  if (toolName === "apply_patch") {
    return "write";
  }

  return "read";
}

export function createToolCall(name: ToolName, input: unknown): ToolCall {
  return {
    id: crypto.randomUUID(),
    name,
    input,
  };
}

export function createToolSettlement(input: {
  call: ToolCall;
  status: ToolSettlementStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  result?: ToolResult;
}): ToolSettlement {
  return {
    toolCallId: input.call.id,
    name: input.call.name,
    status: input.status,
    input: input.call.input,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.result?.output ? { outputPreview: truncateToolPreview(input.result.output) } : {}),
    ...(input.result?.error === undefined ? {} : { error: input.result.error }),
  };
}

export async function runTool(call: ToolCall, runtime: ToolRuntime): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "read":
        return createOkResult(call, readTool(call.input, runtime));
      case "glob":
        return createOkResult(call, globTool(call.input, runtime));
      case "grep":
        return createOkResult(call, grepTool(call.input, runtime));
      case "apply_patch":
        return createOkResult(call, applyPatchTool(call.input, runtime));
      case "bash":
        return createOkResult(call, bashTool(call.input, runtime));
    }
  } catch (error) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["path"]);
  const path = getStringField(inputObject, "path");
  const filePath = resolveWorkspacePath(runtime.workspaceRoot, path);

  return readFileSync(filePath, "utf8");
}

function globTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, ["pattern"]);
  const pattern = getStringField(inputObject, "pattern");
  const matcher = createGlobMatcher(pattern);

  return listFiles(runtime.workspaceRoot)
    .filter((filePath) => matcher(toPosix(relative(runtime.workspaceRoot, filePath))))
    .map((filePath) => toPosix(relative(runtime.workspaceRoot, filePath)))
    .join("\n");
}

function grepTool(input: unknown, runtime: ToolRuntime): string {
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

function bashTool(input: unknown, runtime: ToolRuntime): string {
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

function applyPatchTool(input: unknown, runtime: ToolRuntime): string {
  const inputObject = readObject(input, [], ["patch", "patchFile"]);
  const patch = getOptionalStringField(inputObject, "patch");
  const patchFile = getOptionalStringField(inputObject, "patchFile");
  const patchText =
    typeof patch === "string"
      ? patch
      : typeof patchFile === "string"
        ? readFileSync(resolveWorkspacePath(runtime.workspaceRoot, patchFile), "utf8")
        : undefined;

  if (!patchText) {
    throw new Error("apply_patch requires patch or patchFile.");
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

function createOkResult(call: ToolCall, output: string): ToolResult {
  return {
    id: call.id,
    name: call.name,
    ok: true,
    output,
  };
}

function truncateToolPreview(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}\n[truncated]` : value;
}

function readObject(
  input: unknown,
  requiredFields: string[],
  optionalFields: string[] = [],
): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }

  const inputObject = input as Record<string, unknown>;

  for (const field of requiredFields) {
    if (typeof inputObject[field] !== "string" || inputObject[field].length === 0) {
      throw new Error(`Tool input requires string field: ${field}`);
    }
  }

  for (const field of optionalFields) {
    const value = inputObject[field];

    if (value !== undefined && typeof value !== "string" && typeof value !== "number") {
      throw new Error(`Tool input field must be string or number: ${field}`);
    }
  }

  return inputObject;
}

function getStringField(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string") {
    throw new Error(`Tool input requires string field: ${field}`);
  }

  return value;
}

function getOptionalStringField(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Tool input field must be string: ${field}`);
  }

  return value;
}

function resolveWorkspacePath(workspaceRoot: string, path: unknown): string {
  if (typeof path !== "string") {
    throw new Error("Path must be a string.");
  }

  const resolvedPath = resolve(workspaceRoot, path);
  const relativePath = relative(workspaceRoot, resolvedPath);

  if (
    relativePath.startsWith("..") ||
    relativePath === "" ||
    relativePath.includes(`..${dirname("/")}`)
  ) {
    throw new Error(`Path escapes workspace root: ${path}`);
  }

  return resolvedPath;
}

function listFiles(root: string): string[] {
  const files: string[] = [];
  const ignoredDirectories = new Set([".git", "node_modules", ".turbo", "dist", "coverage"]);

  walk(root);

  return files;

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          walk(entryPath);
        }

        continue;
      }

      if (entry.isFile() && existsSync(entryPath) && !basename(entryPath).endsWith(".db")) {
        files.push(entryPath);
      }
    }
  }
}

function createGlobMatcher(pattern: string): (path: string) => boolean {
  const escaped = pattern
    .replaceAll(".", "\\.")
    .replaceAll("+", "\\+")
    .replaceAll("?", "\\?")
    .replaceAll("^", "\\^")
    .replaceAll("$", "\\$")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("|", "\\|")
    .replaceAll("**", "::DOUBLE_STAR::")
    .replaceAll("*", "[^/]*")
    .replaceAll("::DOUBLE_STAR::", ".*");
  const regex = new RegExp(`^${escaped}$`);

  return (path) => regex.test(path);
}

function toPosix(path: string): string {
  return path.split(dirname("/")).join("/");
}
