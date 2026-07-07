import type { Session, SessionEvent } from "./session.js";

export type SessionMaintenancePlan = {
  sessionId: string;
  titleCandidate?: string;
  summaryCandidate?: string;
  cleanupCandidate: boolean;
  cleanupReason?: string;
};

export function planSessionMaintenance(input: {
  session: Session;
  events: SessionEvent[];
  minEventsForSummary?: number;
}): SessionMaintenancePlan {
  const minEventsForSummary = input.minEventsForSummary ?? 20;
  const meaningfulUserMessages = input.events.filter(isMeaningfulUserMessage);
  const assistantMessages = input.events.filter((event) => event.type === "assistant_message");
  const titleCandidate = shouldGenerateTitle(input.session)
    ? createTitleCandidate(meaningfulUserMessages)
    : undefined;
  const latestSummarySequence = Math.max(
    0,
    ...input.events
      .filter((event) => event.type === "context_summary")
      .map((event) => event.sequence),
  );
  const eventsAfterSummary = input.events.filter((event) => event.sequence > latestSummarySequence);
  const summaryCandidate =
    eventsAfterSummary.length >= minEventsForSummary
      ? createSummaryCandidate(eventsAfterSummary)
      : undefined;
  const cleanupCandidate = meaningfulUserMessages.length === 0 && assistantMessages.length === 0;

  return {
    sessionId: input.session.id,
    ...(titleCandidate === undefined ? {} : { titleCandidate }),
    ...(summaryCandidate === undefined ? {} : { summaryCandidate }),
    cleanupCandidate,
    ...(cleanupCandidate ? { cleanupReason: "empty or command-only session" } : {}),
  };
}

function shouldGenerateTitle(session: Session): boolean {
  return (
    session.title === undefined ||
    session.title === "MAGI TUI session" ||
    session.title === "Untitled session" ||
    session.title === "New empty session" ||
    session.title === "Command-only session"
  );
}

function createTitleCandidate(events: SessionEvent[]): string | undefined {
  const firstMessage = events[0];
  const payload = firstMessage?.payload as { content?: unknown } | undefined;

  return typeof payload?.content === "string" ? truncateTitle(payload.content) : undefined;
}

function createSummaryCandidate(events: SessionEvent[]): string {
  const lines = events.flatMap((event) => {
    switch (event.type) {
      case "user_message": {
        const payload = event.payload as { content?: unknown };

        return typeof payload.content === "string"
          ? [`User asked: ${truncateOneLine(payload.content)}`]
          : [];
      }
      case "assistant_message": {
        const payload = event.payload as { content?: unknown };

        return typeof payload.content === "string"
          ? [`Assistant responded: ${truncateOneLine(payload.content)}`]
          : [];
      }
      case "verification_result": {
        const payload = event.payload as { command?: unknown; status?: unknown };

        return [
          `Verification: ${String(payload.command ?? "unknown")}: ${String(payload.status ?? "unknown")}`,
        ];
      }
      case "tool_settlement": {
        const payload = event.payload as { name?: unknown; status?: unknown };

        return [`Tool: ${String(payload.name ?? "tool")}: ${String(payload.status ?? "unknown")}`];
      }
      default:
        return [];
    }
  });

  return lines.slice(-20).join("\n") || "No summary-worthy events.";
}

function isMeaningfulUserMessage(event: SessionEvent): boolean {
  if (event.type !== "user_message") {
    return false;
  }

  const payload = event.payload as { content?: unknown };

  return typeof payload.content === "string" && isMeaningfulPrompt(payload.content);
}

function isMeaningfulPrompt(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized.length < 6 || normalized.startsWith("/")) {
    return false;
  }

  return !new Set([
    "hello",
    "hello!",
    "hi",
    "hi!",
    "안녕",
    "안녕!",
    "안녕하세요",
    "안녕하세요!",
    "test",
    "test!",
    "테스트",
    "테스트!",
  ]).has(normalized);
}

function truncateTitle(value: string): string {
  const title = value.trim().replaceAll("\n", " ");

  return title.length > 60 ? `${title.slice(0, 60)}...` : title;
}

function truncateOneLine(value: string): string {
  const oneLine = value.replaceAll("\n", " ");

  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}...` : oneLine;
}
