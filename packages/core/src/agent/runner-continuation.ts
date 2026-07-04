import type { SessionEvent } from "../session.js";
import type { AgentRunContinuation } from "./runner-types.js";

export function getAgentRunContinuation(input: {
  events: SessionEvent[];
  maxSteps: number;
}): AgentRunContinuation {
  const latestInterruption = findLatestEvent(input.events, "interruption");
  const latestAssistantMessage = findLatestEvent(input.events, "assistant_message");
  const latestUserMessage = findLatestEvent(input.events, "user_message");
  const stepCount = input.events.filter((event) => event.type === "agent_step_started").length;

  if (isInterrupted(latestInterruption, latestAssistantMessage)) {
    return { shouldContinue: false, reason: "interrupted" };
  }

  if (hasUnsettledTools(input.events)) {
    return { shouldContinue: false, reason: "pending_tool_results" };
  }

  if (stepCount >= input.maxSteps && !latestAssistantMessage) {
    return { shouldContinue: true, reason: "final_response_required" };
  }

  if (isCompleted(latestAssistantMessage, latestUserMessage)) {
    return { shouldContinue: false, reason: "completed" };
  }

  if (hasQueuedInput(input.events, latestUserMessage)) {
    return { shouldContinue: true, reason: "queued_user_input" };
  }

  if (input.events.some((event) => event.type === "tool_settlement")) {
    return { shouldContinue: true, reason: "all_tools_settled" };
  }

  return { shouldContinue: true, reason: "new_user_input" };
}

function findLatestEvent(
  events: SessionEvent[],
  type: SessionEvent["type"],
): SessionEvent | undefined {
  return [...events].reverse().find((event) => event.type === type);
}

function isInterrupted(
  latestInterruption: SessionEvent | undefined,
  latestAssistantMessage: SessionEvent | undefined,
): boolean {
  return (
    latestInterruption !== undefined &&
    (!latestAssistantMessage || latestInterruption.sequence > latestAssistantMessage.sequence)
  );
}

function isCompleted(
  latestAssistantMessage: SessionEvent | undefined,
  latestUserMessage: SessionEvent | undefined,
): boolean {
  return (
    latestAssistantMessage !== undefined &&
    (!latestUserMessage || latestAssistantMessage.sequence > latestUserMessage.sequence)
  );
}

function hasQueuedInput(
  events: SessionEvent[],
  latestUserMessage: SessionEvent | undefined,
): boolean {
  const latestQueuedInput = findLatestEvent(events, "queued_user_input");

  return (
    latestQueuedInput !== undefined &&
    (!latestUserMessage || latestQueuedInput.sequence > latestUserMessage.sequence)
  );
}

function hasUnsettledTools(events: SessionEvent[]): boolean {
  const statuses = new Map<string, string>();

  for (const event of events) {
    if (event.type !== "tool_settlement") continue;

    const payload = event.payload as { toolCallId?: unknown; status?: unknown };

    if (typeof payload.toolCallId === "string" && typeof payload.status === "string") {
      statuses.set(payload.toolCallId, payload.status);
    }
  }

  return [...statuses.values()].some((status) => status === "pending" || status === "running");
}
