import type { SessionEvent } from "../session.js";

export type CompactSessionContextResult = {
  text: string;
  overflowRecovered: boolean;
  summaryCreated: boolean;
  retainedEventSequences: number[];
};

export function compactSessionContext(input: {
  events: SessionEvent[];
  maxCharacters?: number;
  recentEventCount?: number;
  maxToolOutputCharacters?: number;
}): CompactSessionContextResult {
  const maxCharacters = input.maxCharacters ?? 18_000;
  const recentEventCount = input.recentEventCount ?? 30;
  const maxToolOutputCharacters = input.maxToolOutputCharacters ?? 1_000;
  const latestSummary = [...input.events]
    .reverse()
    .find((event) => event.type === "context_summary" || event.type === "summary");
  const latestSummarySequence = latestSummary?.sequence ?? 0;
  const recentEvents = input.events
    .filter((event) => event.sequence > latestSummarySequence)
    .slice(-recentEventCount);
  const retainedEventSequences = recentEvents.map((event) => event.sequence);
  const sections = [
    formatSummary(latestSummary),
    ...recentEvents.flatMap((event) => formatEvent(event, maxToolOutputCharacters)),
  ].filter((section) => section.length > 0);
  const rawText = sections.length === 0 ? "No prior session context." : sections.join("\n\n");

  if (rawText.length <= maxCharacters) {
    return {
      text: rawText,
      overflowRecovered: false,
      summaryCreated: latestSummary !== undefined,
      retainedEventSequences,
    };
  }

  const summaryText = formatSummary(latestSummary);
  const recentText = recentEvents
    .slice(-Math.max(1, Math.floor(recentEventCount / 2)))
    .flatMap((event) => formatEvent(event, Math.min(maxToolOutputCharacters, 500)))
    .join("\n\n");
  const compactedText = [
    summaryText || "[Earlier session context omitted because it exceeded the context budget]",
    recentText,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");

  return {
    text:
      compactedText.length > maxCharacters
        ? `[Earlier session context truncated]\n${compactedText.slice(-maxCharacters)}`
        : compactedText,
    overflowRecovered: true,
    summaryCreated: latestSummary !== undefined,
    retainedEventSequences: recentEvents
      .slice(-Math.max(1, Math.floor(recentEventCount / 2)))
      .map((event) => event.sequence),
  };
}

function formatSummary(event: SessionEvent | undefined): string {
  if (!event) {
    return "";
  }

  const payload = event.payload as { text?: unknown; summary?: unknown };
  const text = typeof payload.text === "string" ? payload.text : payload.summary;

  return typeof text === "string" ? `Earlier context summary:\n${truncateTail(text, 4_000)}` : "";
}

function formatEvent(event: SessionEvent, maxToolOutputCharacters: number): string[] {
  switch (event.type) {
    case "user_message": {
      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string"
        ? [`User: ${truncateTail(payload.content, 2_000)}`]
        : [];
    }
    case "queued_user_input": {
      const payload = event.payload as { content?: unknown; mode?: unknown };

      return typeof payload.content === "string"
        ? [`Queued ${String(payload.mode ?? "input")}: ${truncateTail(payload.content, 1_000)}`]
        : [];
    }
    case "assistant_message": {
      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string"
        ? [`Assistant: ${truncateTail(payload.content, 2_000)}`]
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
    case "tool_settlement": {
      const payload = event.payload as {
        name?: unknown;
        status?: unknown;
        outputPreview?: unknown;
        error?: unknown;
      };
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const status = typeof payload.status === "string" ? payload.status : "unknown";
      const detail =
        typeof payload.error === "string" && payload.error.length > 0
          ? payload.error
          : typeof payload.outputPreview === "string"
            ? payload.outputPreview
            : "";

      return [
        `Tool settlement: ${name}: ${status}${detail ? `\n${truncateTail(detail, maxToolOutputCharacters)}` : ""}`,
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

      return [
        `Tool result: ${name}: ${status}${detail ? `\n${truncateTail(detail, maxToolOutputCharacters)}` : ""}`,
      ];
    }
    case "provider_error": {
      const payload = event.payload as { message?: unknown };

      return typeof payload.message === "string"
        ? [`Provider error: ${truncateTail(payload.message, 1_000)}`]
        : [];
    }
    case "interruption": {
      const payload = event.payload as { reason?: unknown };

      return [`Interrupted: ${String(payload.reason ?? "unknown")}`];
    }
    case "proposed_patch": {
      const payload = event.payload as { summary?: unknown };

      return typeof payload.summary === "string" ? [`Proposed patch: ${payload.summary}`] : [];
    }
    default:
      return [];
  }
}

function truncateTail(value: string, maxCharacters: number): string {
  return value.length > maxCharacters ? `${value.slice(0, maxCharacters)}\n[truncated]` : value;
}
