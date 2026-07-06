import type { ToolName } from "../tools.js";
import {
  isLspPositionActionType,
  readLspPositionAction,
  type LspPositionAgentAction,
} from "./actions-lsp.js";
import { readWebsearchAction, type WebsearchAgentAction } from "./actions-websearch.js";

export type AgentAction =
  | { type: "answer"; content: string }
  | { type: "read"; path: string }
  | { type: "glob"; pattern: string }
  | { type: "grep"; pattern: string; include?: string }
  | { type: "edit"; filePath: string; oldString: string; newString: string; replaceAll?: boolean }
  | { type: "write"; filePath: string; content: string }
  | { type: "apply_patch"; patchText: string }
  | { type: "webfetch"; url: string; format?: "text" | "markdown" | "html"; timeout?: number }
  | WebsearchAgentAction
  | { type: "todowrite"; todos: unknown[] }
  | { type: "question"; questions: unknown[] }
  | { type: "skill"; name: string }
  | { type: "lsp_symbols"; filePath: string }
  | LspPositionAgentAction
  | {
      type: "task";
      description: string;
      prompt: string;
      subagent_type: string;
      task_id?: string;
      command?: string;
      background?: boolean;
    }
  | { type: "plan_exit" }
  | { type: "invalid_tool"; toolName: string; reason: string; input?: unknown }
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
  if (isLspPositionActionType(type)) {
    return readLspPositionAction(action, type);
  }

  switch (type) {
    case "answer":
      return { type, content: readString(action, "content") };
    case "read":
      return { type, path: readString(action, "path") };
    case "glob":
      return { type, pattern: readString(action, "pattern") };
    case "grep":
      return readGrepAction(action);
    case "edit":
      return readEditAction(action);
    case "write":
      return readWriteAction(action);
    case "apply_patch":
      return { type, patchText: readString(action, "patchText") };
    case "webfetch":
      return readWebfetchAction(action);
    case "websearch":
      return readWebsearchAction(action);
    case "todowrite":
      return { type, todos: readArray(action, "todos") };
    case "question":
      return { type, questions: readArray(action, "questions") };
    case "skill":
      return { type, name: readString(action, "name") };
    case "lsp_symbols":
      return { type, filePath: readString(action, "filePath") };
    case "task":
      return readTaskAction(action);
    case "plan_exit":
      return { type };
    case "verify": {
      const command = readOptionalString(action, "command");

      return { type, ...(command === undefined ? {} : { command }) };
    }
    case "propose_patch":
      return readProposePatchAction(action);
    case "finish":
      return { type, summary: readString(action, "summary") };
    default:
      throw new Error(`Unsupported agent action type: ${type}`);
  }
}

function readEditAction(action: Record<string, unknown>): AgentAction {
  const replaceAll = readOptionalBoolean(action, "replaceAll");

  return {
    type: "edit",
    filePath: readString(action, "filePath"),
    oldString: readStringAllowEmpty(action, "oldString"),
    newString: readStringAllowEmpty(action, "newString"),
    ...(replaceAll === undefined ? {} : { replaceAll }),
  };
}

function readProposePatchAction(action: Record<string, unknown>): AgentAction {
  const summary = readOptionalString(action, "summary");

  return {
    type: "propose_patch",
    patch: readString(action, "patch"),
    ...(summary === undefined ? {} : { summary }),
  };
}

function readGrepAction(action: Record<string, unknown>): AgentAction {
  const include = readOptionalString(action, "include");

  return {
    type: "grep",
    pattern: readString(action, "pattern"),
    ...(include === undefined ? {} : { include }),
  };
}

function readWriteAction(action: Record<string, unknown>): AgentAction {
  return {
    type: "write",
    filePath: readString(action, "filePath"),
    content: readStringAllowEmpty(action, "content"),
  };
}

function readWebfetchAction(action: Record<string, unknown>): AgentAction {
  const format = readOptionalFormat(action, "format");
  const timeout = readOptionalNumber(action, "timeout");

  return {
    type: "webfetch",
    url: readString(action, "url"),
    ...(format === undefined ? {} : { format }),
    ...(timeout === undefined ? {} : { timeout }),
  };
}

function readTaskAction(action: Record<string, unknown>): AgentAction {
  const taskId = readOptionalString(action, "task_id");
  const command = readOptionalString(action, "command");
  const background = readOptionalBoolean(action, "background");

  return {
    type: "task",
    description: readString(action, "description"),
    prompt: readString(action, "prompt"),
    subagent_type: readString(action, "subagent_type"),
    ...(taskId === undefined ? {} : { task_id: taskId }),
    ...(command === undefined ? {} : { command }),
    ...(background === undefined ? {} : { background }),
  };
}

export function agentActionToToolName(action: ExecutableAgentAction): ToolName | undefined {
  if (
    action.type === "read" ||
    action.type === "glob" ||
    action.type === "grep" ||
    action.type === "edit" ||
    action.type === "write" ||
    action.type === "apply_patch" ||
    action.type === "webfetch" ||
    action.type === "websearch" ||
    action.type === "todowrite" ||
    action.type === "question" ||
    action.type === "skill" ||
    action.type === "lsp_symbols" ||
    action.type === "lsp_definition" ||
    action.type === "lsp_references" ||
    action.type === "lsp_hover" ||
    action.type === "lsp_call_hierarchy" ||
    action.type === "task" ||
    action.type === "plan_exit"
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

function readOptionalNumber(value: Record<string, unknown>, field: string): number | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) {
    return undefined;
  }

  if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue)) {
    throw new Error(`${field} must be a number when provided.`);
  }

  return fieldValue;
}

function readOptionalFormat(
  value: Record<string, unknown>,
  field: string,
): "text" | "markdown" | "html" | undefined {
  const fieldValue = readOptionalString(value, field);

  if (fieldValue === undefined) {
    return undefined;
  }

  if (fieldValue !== "text" && fieldValue !== "markdown" && fieldValue !== "html") {
    throw new Error(`${field} must be text, markdown, or html when provided.`);
  }

  return fieldValue;
}

function readArray(value: Record<string, unknown>, field: string): unknown[] {
  const fieldValue = value[field];

  if (!Array.isArray(fieldValue)) {
    throw new Error(`${field} must be an array.`);
  }

  return fieldValue;
}
