// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Characterizes the persisted session event union in one display formatter.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Keeping the event switch together makes persisted display behavior auditable.
import type { SessionEvent } from "@magi/core";
import { formatOutputSummary, truncateOneLine } from "./display-format.js";

export function formatSessionEventSummary(event: SessionEvent): string {
  switch (event.type) {
    case "user_message":
    case "assistant_message": {
      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string" ? truncateOneLine(payload.content) : "(invalid)";
    }
    case "tool_call": {
      const payload = event.payload as { name?: unknown };

      return typeof payload.name === "string" ? payload.name : "tool";
    }
    case "tool_result": {
      const payload = event.payload as {
        name?: unknown;
        ok?: unknown;
        output?: unknown;
        error?: unknown;
      };
      const name = typeof payload.name === "string" ? payload.name : "tool";

      if (payload.ok !== true) {
        return `${name}: failed${typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : ""}`;
      }

      return `${name}: ${formatOutputSummary(typeof payload.output === "string" ? payload.output : "")}`;
    }
    case "tool_settlement": {
      const payload = event.payload as { name?: unknown; status?: unknown; error?: unknown };
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const status = typeof payload.status === "string" ? payload.status : "unknown";

      return `${name}: ${status}${typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : ""}`;
    }
    case "agent_step_started": {
      const payload = event.payload as { reason?: unknown };
      return `step started: ${String(payload.reason ?? "unknown")}`;
    }
    case "assistant_started":
      return "assistant started";
    case "assistant_status": {
      const payload = event.payload as { kind?: unknown; text?: unknown };
      const kind = typeof payload.kind === "string" ? payload.kind : "status";
      return typeof payload.text === "string" ? `${kind}: ${truncateOneLine(payload.text)}` : kind;
    }
    case "assistant_stream": {
      const payload = event.payload as { kind?: unknown; toolName?: unknown; text?: unknown };
      const kind = typeof payload.kind === "string" ? payload.kind : "stream";
      const toolName = typeof payload.toolName === "string" ? ` ${payload.toolName}` : "";
      const text = typeof payload.text === "string" ? `: ${truncateOneLine(payload.text)}` : "";
      return `${kind}${toolName}${text}`;
    }
    case "agent_tool_skipped": {
      const payload = event.payload as { toolName?: unknown; reason?: unknown };
      const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool";
      const reason =
        typeof payload.reason === "string" ? `: ${truncateOneLine(payload.reason)}` : "";
      return `${toolName}: skipped${reason}`;
    }
    case "agent_step_ended": {
      const payload = event.payload as { status?: unknown };
      return `step ended: ${String(payload.status ?? "unknown")}`;
    }
    case "provider_error": {
      const payload = event.payload as { message?: unknown };
      return typeof payload.message === "string"
        ? truncateOneLine(payload.message)
        : "provider error";
    }
    case "interruption": {
      const payload = event.payload as { reason?: unknown };
      return `interrupted: ${String(payload.reason ?? "unknown")}`;
    }
    case "context_summary":
      return "context summary";
    case "queued_user_input": {
      const payload = event.payload as { content?: unknown; mode?: unknown };
      return `${String(payload.mode ?? "queued")}: ${typeof payload.content === "string" ? truncateOneLine(payload.content) : "input"}`;
    }
    case "verification_result": {
      const payload = event.payload as { command?: unknown; status?: unknown };
      return `${typeof payload.command === "string" ? payload.command : "unknown"}: ${typeof payload.status === "string" ? payload.status : "unknown"}`;
    }
    case "permission_decision": {
      const payload = event.payload as { action?: unknown; decision?: unknown };
      return `${String(payload.action ?? "permission")}: ${String(payload.decision ?? "unknown")}`;
    }
    case "proposed_patch": {
      const payload = event.payload as { summary?: unknown };
      return typeof payload.summary === "string" ? truncateOneLine(payload.summary) : "patch saved";
    }
    case "summary":
      return "workspace summary";
    case "agent_switch": {
      const payload = event.payload as { agentId?: unknown; previousAgentId?: unknown };
      const previous =
        typeof payload.previousAgentId === "string" ? `${payload.previousAgentId} -> ` : "";
      return `agent: ${previous}${String(payload.agentId ?? "unknown")}`;
    }
    case "model_switch": {
      const payload = event.payload as { providerId?: unknown; model?: unknown };
      return `${String(payload.providerId ?? "unknown")}: ${String(payload.model ?? "unknown")}`;
    }
    case "todo_update":
      return `${countOpenTodos(event.payload)} open`;
    case "task_update": {
      const payload = event.payload as {
        description?: unknown;
        status?: unknown;
        error?: unknown;
      };
      const status = typeof payload.status === "string" ? payload.status : "unknown";
      const description =
        typeof payload.description === "string" ? truncateOneLine(payload.description) : "task";
      const error = typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : "";
      return `${status}: ${description}${error}`;
    }
    case "plan_exit": {
      const payload = event.payload as { accepted?: unknown; planPath?: unknown };
      return `${payload.accepted === true ? "accepted" : "continued"}: ${String(payload.planPath ?? "plan")}`;
    }
    case "magi_decision_trail":
      return "MAGI decision trail";
  }
}

function countOpenTodos(payload: unknown): number {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return 0;
  const todos = (payload as Record<string, unknown>).todos;
  if (!Array.isArray(todos)) return 0;

  return todos.filter(
    (todo) =>
      typeof todo === "object" &&
      todo !== null &&
      !Array.isArray(todo) &&
      typeof (todo as Record<string, unknown>).content === "string" &&
      typeof (todo as Record<string, unknown>).status === "string" &&
      typeof (todo as Record<string, unknown>).priority === "string" &&
      (todo as Record<string, unknown>).status !== "completed",
  ).length;
}
