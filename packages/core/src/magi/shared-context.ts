import type { SessionEvent } from "../session.js";
import type { ReviewResponse } from "./review.js";
import type { VoteResponse } from "./vote.js";

export type SharedContextEntry =
  | { type: "requirement"; content: string; createdAt: string }
  | { type: "plan"; content: string; createdAt: string }
  | { type: "diff"; content: string; createdAt: string }
  | {
      type: "verification";
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      createdAt: string;
    }
  | {
      type: "review";
      engineId: string;
      lensIds: string[];
      response: ReviewResponse;
      createdAt: string;
    }
  | { type: "vote"; engineId: string; response: VoteResponse; createdAt: string }
  | { type: "revision"; content: string; createdAt: string };

export type SharedContextHistory = {
  entries: SharedContextEntry[];
};

export function buildSharedContextHistory(input: {
  requirement: string;
  plan?: string;
  diff?: string;
  sessionEvents?: SessionEvent[];
  createdAt?: string;
}): SharedContextHistory {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const entries: SharedContextEntry[] = [
    { type: "requirement", content: input.requirement, createdAt },
  ];

  if (input.plan) {
    entries.push({ type: "plan", content: input.plan, createdAt });
  }

  if (input.diff) {
    entries.push({ type: "diff", content: input.diff, createdAt });
  }

  for (const event of input.sessionEvents ?? []) {
    const entry = sessionEventToSharedContextEntry(event);

    if (entry) {
      entries.push(entry);
    }
  }

  return { entries };
}

function sessionEventToSharedContextEntry(event: SessionEvent): SharedContextEntry | undefined {
  const payload = event.payload as Record<string, unknown>;

  if (event.type === "verification_result") {
    if (typeof payload.command !== "string" || typeof payload.exitCode !== "number") {
      return undefined;
    }

    return {
      type: "verification",
      command: payload.command,
      exitCode: payload.exitCode,
      stdout: typeof payload.stdout === "string" ? payload.stdout : "",
      stderr: typeof payload.stderr === "string" ? payload.stderr : "",
      createdAt: event.createdAt,
    };
  }

  if (event.type === "proposed_patch" && typeof payload.patch === "string") {
    return { type: "diff", content: payload.patch, createdAt: event.createdAt };
  }

  if (
    event.type === "assistant_message" &&
    payload.revision === true &&
    typeof payload.content === "string"
  ) {
    return { type: "revision", content: payload.content, createdAt: event.createdAt };
  }

  return undefined;
}
