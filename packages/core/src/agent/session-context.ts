import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { SessionEvent } from "../session.js";
import { compactSessionContext } from "./context-compaction.js";

export function buildAgentSessionContext(input: {
  events: SessionEvent[];
  maxEvents?: number;
  maxCharacters?: number;
}): string {
  return compactSessionContext({
    events: input.events,
    recentEventCount: input.maxEvents,
    maxCharacters: input.maxCharacters,
  }).text;
}

export function buildAgentSystemContext(input: {
  workspaceRoot: string;
  cwd?: string;
  now?: Date;
}): string[] {
  const cwd = resolve(input.cwd ?? input.workspaceRoot);
  const workspaceRoot = resolve(input.workspaceRoot);
  const now = input.now ?? new Date();

  return [
    buildEnvironmentContext({ cwd, workspaceRoot, now }),
    ...loadProjectInstructions({ cwd, workspaceRoot }),
  ];
}

function buildEnvironmentContext(input: { cwd: string; workspaceRoot: string; now: Date }): string {
  return [
    "<env>",
    `  Working directory: ${input.cwd}`,
    `  Workspace root folder: ${input.workspaceRoot}`,
    `  Is directory a git repo: ${isGitRepository(input.workspaceRoot) ? "yes" : "no"}`,
    `  Platform: ${process.platform}`,
    `  Today's date: ${input.now.toDateString()}`,
    "</env>",
  ].join("\n");
}

function loadProjectInstructions(input: { cwd: string; workspaceRoot: string }): string[] {
  const instructionPath = findProjectInstructionPath(input);

  if (!instructionPath) {
    return [];
  }

  try {
    return [
      `Instructions from: ${instructionPath}\n${readFileSync(instructionPath, "utf8").trim()}`,
    ];
  } catch {
    return [];
  }
}

function findProjectInstructionPath(input: {
  cwd: string;
  workspaceRoot: string;
}): string | undefined {
  const names = ["AGENTS.md", "CLAUDE.md", "CONTEXT.md"];
  let current = input.cwd;

  while (isWithinOrEqual(current, input.workspaceRoot)) {
    for (const name of names) {
      const candidate = join(current, name);

      if (isReadableFile(candidate)) {
        return candidate;
      }
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return undefined;
}

function isGitRepository(workspaceRoot: string): boolean {
  let current = workspaceRoot;

  while (true) {
    if (existsSync(join(current, ".git"))) {
      return true;
    }

    const parent = dirname(current);

    if (parent === current) {
      return false;
    }

    current = parent;
  }
}

function isReadableFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isWithinOrEqual(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}
