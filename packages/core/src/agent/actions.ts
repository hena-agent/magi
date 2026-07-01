import type { ToolName } from "../tools.js";

export type AgentAction =
  | { type: "answer"; content: string }
  | { type: "read"; path: string }
  | { type: "glob"; pattern: string }
  | { type: "grep"; pattern: string; include?: string }
  | { type: "verify"; command?: string }
  | { type: "propose_patch"; patch: string; summary?: string }
  | { type: "finish"; summary: string };

export type ExecutableAgentAction = Exclude<AgentAction, { type: "answer" | "finish" }>;

export function validateAgentAction(value: unknown): AgentAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent action must be an object.");
  }

  const action = value as Record<string, unknown>;
  const type = readString(action, "type");

  switch (type) {
    case "answer":
      return { type, content: readString(action, "content") };
    case "read":
      return { type, path: readString(action, "path") };
    case "glob":
      return { type, pattern: readString(action, "pattern") };
    case "grep": {
      const include = readOptionalString(action, "include");

      return {
        type,
        pattern: readString(action, "pattern"),
        ...(include === undefined ? {} : { include }),
      };
    }
    case "verify": {
      const command = readOptionalString(action, "command");

      return { type, ...(command === undefined ? {} : { command }) };
    }
    case "propose_patch": {
      const summary = readOptionalString(action, "summary");

      return {
        type,
        patch: readString(action, "patch"),
        ...(summary === undefined ? {} : { summary }),
      };
    }
    case "finish":
      return { type, summary: readString(action, "summary") };
    default:
      throw new Error(`Unsupported agent action type: ${type}`);
  }
}

export function agentActionToToolName(action: ExecutableAgentAction): ToolName | undefined {
  if (action.type === "read" || action.type === "glob" || action.type === "grep") {
    return action.type;
  }

  return undefined;
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return fieldValue;
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string when provided.`);
  }

  return fieldValue;
}
