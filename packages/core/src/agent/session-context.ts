import type { SessionEvent } from "../session.js";

export function buildAgentSessionContext(input: {
  events: SessionEvent[];
  maxEvents?: number;
  maxCharacters?: number;
}): string {
  const maxEvents = input.maxEvents ?? 30;
  const maxCharacters = input.maxCharacters ?? 18_000;
  const entries = input.events.slice(-maxEvents).flatMap(formatEvent);
  const text = entries.length === 0 ? "No prior session context." : entries.join("\n\n");

  return truncateHead(text, maxCharacters);
}

function formatEvent(event: SessionEvent): string[] {
  switch (event.type) {
    case "user_message": {
      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string"
        ? [`User: ${truncateTail(payload.content, 2_000)}`]
        : [];
    }
    case "assistant_message": {
      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string"
        ? [`Assistant: ${truncateTail(payload.content, 2_000)}`]
        : [];
    }
    case "summary": {
      const payload = event.payload as { text?: unknown };

      return typeof payload.text === "string"
        ? [`Summary:\n${truncateTail(payload.text, 2_000)}`]
        : [];
    }
    case "verification_result": {
      const payload = event.payload as { command?: unknown; status?: unknown; stderr?: unknown };
      const command = typeof payload.command === "string" ? payload.command : "unknown command";
      const status = typeof payload.status === "string" ? payload.status : "unknown";
      const stderr = typeof payload.stderr === "string" && payload.stderr.length > 0;

      return [
        `Verification: ${command}: ${status}${stderr ? `\nstderr:\n${truncateTail(payload.stderr as string, 1_000)}` : ""}`,
      ];
    }
    case "tool_result": {
      const payload = event.payload as {
        name?: unknown;
        ok?: unknown;
        output?: unknown;
        error?: unknown;
      };
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const status = payload.ok === true ? "ok" : "failed";
      const detail =
        typeof payload.error === "string" && payload.error.length > 0
          ? payload.error
          : typeof payload.output === "string"
            ? payload.output
            : "";

      return [`Tool result: ${name}: ${status}${detail ? `\n${truncateTail(detail, 1_000)}` : ""}`];
    }
    case "proposed_patch": {
      const payload = event.payload as { summary?: unknown };

      return typeof payload.summary === "string" ? [`Proposed patch: ${payload.summary}`] : [];
    }
    default:
      return [];
  }
}

function truncateHead(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) {
    return value;
  }

  return `[Earlier session context truncated]\n${value.slice(-maxCharacters)}`;
}

function truncateTail(value: string, maxCharacters: number): string {
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters)}\n[truncated]` : value;
}
