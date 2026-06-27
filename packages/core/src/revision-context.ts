import { execSync } from "node:child_process";
import type { SessionEvent } from "./session.js";
import { getLatestVerificationFailures, type VerificationFailure } from "./verification-context.js";

export type RevisionContext = {
  latestUserMessage?: string;
  latestAssistantMessage?: string;
  verificationFailures: VerificationFailure[];
  changedFiles: string[];
  text: string;
};

export function buildRevisionContext(input: {
  workspaceRoot: string;
  events: SessionEvent[];
  maxOutputChars?: number;
}): RevisionContext {
  const latestUserMessage = findLatestMessage(input.events, "user_message");
  const latestAssistantMessage = findLatestMessage(input.events, "assistant_message");
  const failureContext = getLatestVerificationFailures({
    events: input.events,
    maxOutputChars: input.maxOutputChars,
  });
  const changedFiles = readChangedFiles(input.workspaceRoot);
  const text = [
    "You are revising a local code change after verification failures.",
    "",
    "Latest user request:",
    latestUserMessage ?? "(none)",
    "",
    "Latest assistant response:",
    latestAssistantMessage ?? "(none)",
    "",
    "Changed files:",
    ...(changedFiles.length === 0 ? ["- none"] : changedFiles.map((file) => `- ${file}`)),
    "",
    failureContext.text,
    "",
    "Task:",
    "Suggest the smallest correct fix. If a patch is appropriate, provide a git-apply-compatible unified diff inside a ```diff fenced code block. Do not claim you ran commands.",
  ].join("\n");

  return {
    ...(latestUserMessage === undefined ? {} : { latestUserMessage }),
    ...(latestAssistantMessage === undefined ? {} : { latestAssistantMessage }),
    verificationFailures: failureContext.failures,
    changedFiles,
    text,
  };
}

export function extractFirstDiffBlock(content: string): string | undefined {
  const match = /```(?:diff|patch)\n(?<patch>[\s\S]*?)```/.exec(content);

  return match?.groups?.patch?.trim();
}

export function getLatestProposedPatch(events: SessionEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== "proposed_patch") {
      continue;
    }

    const payload = event.payload as { patch?: unknown };

    if (typeof payload.patch === "string" && payload.patch.length > 0) {
      return payload.patch;
    }
  }

  return undefined;
}

function findLatestMessage(
  events: SessionEvent[],
  type: "user_message" | "assistant_message",
): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== type) {
      continue;
    }

    const payload = event.payload as { content?: unknown };

    if (typeof payload.content === "string") {
      return payload.content;
    }
  }

  return undefined;
}

function readChangedFiles(workspaceRoot: string): string[] {
  const output = execSync("git status --short", {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();

  if (output.length === 0) {
    return [];
  }

  return output.split("\n").map((line) => line.slice(3).trim());
}
