import type { ToolName } from "../tools.js";

export type AgentAction =
  | { type: "answer"; content: string }
  | { type: "read"; path: string }
  | { type: "glob"; pattern: string }
  | { type: "grep"; pattern: string; include?: string }
  | { type: "edit"; filePath: string; oldString: string; newString: string; replaceAll?: boolean }
  | { type: "write"; filePath: string; content: string }
  | { type: "apply_patch"; patchText: string }
  | { type: "verify"; command?: string }
  | { type: "propose_patch"; patch: string; summary?: string }
  | { type: "finish"; summary: string };

export type ExecutableAgentAction = Exclude<AgentAction, { type: "answer" | "finish" }>;

export function validateAgentAction(value: unknown): AgentAction {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Agent action must be an object.");
  }

  const action = value as Record<string, unknown>;

  return readActionByType(action, readString(action, "type"));
}

function readActionByType(action: Record<string, unknown>, type: string): AgentAction {
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
    case "edit": {
      const replaceAll = readOptionalBoolean(action, "replaceAll");

      return {
        type,
        filePath: readString(action, "filePath"),
        oldString: readStringAllowEmpty(action, "oldString"),
        newString: readStringAllowEmpty(action, "newString"),
        ...(replaceAll === undefined ? {} : { replaceAll }),
      };
    }
    case "write":
      return {
        type,
        filePath: readString(action, "filePath"),
        content: readStringAllowEmpty(action, "content"),
      };
    case "apply_patch":
      return { type, patchText: readString(action, "patchText") };
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
  if (
    action.type === "read" ||
    action.type === "glob" ||
    action.type === "grep" ||
    action.type === "edit" ||
    action.type === "write" ||
    action.type === "apply_patch"
  ) {
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

function readStringAllowEmpty(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string") {
    throw new Error(`${field} must be a string.`);
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

function readOptionalBoolean(value: Record<string, unknown>, field: string): boolean | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== "boolean") {
    throw new Error(`${field} must be a boolean when provided.`);
  }

  return fieldValue;
}
