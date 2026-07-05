import type { ModelToolCall } from "../model.js";
import type { ToolName } from "../tools.js";
import type { ExecutableAgentAction } from "./actions.js";
import type { AgentInfo } from "./registry.js";
import {
  editNativeToolDefinitions,
  networkNativeToolDefinitions,
  patchNativeToolDefinitions,
  readNativeToolDefinitions,
} from "./runner-native-tool-definitions.js";

export function getNativeToolDefinitions(agent: AgentInfo, model: string | undefined) {
  return [
    ...(agent.permission.read === "deny" ? [] : readNativeToolDefinitions),
    ...(agent.permission.network === "deny" ? [] : networkNativeToolDefinitions),
    ...(agent.id === "plan" ? editNativeToolDefinitions : []),
    ...(agent.permission.write === "deny"
      ? []
      : getEditToolMode(agent, model) === "patch"
        ? patchNativeToolDefinitions
        : editNativeToolDefinitions),
  ];
}

export function getEditToolMode(_agent: AgentInfo, model?: string): "patch" | "edit" {
  if (!model) {
    return "patch";
  }

  return model.includes("gpt-") && !model.includes("oss") && !model.includes("gpt-4")
    ? "patch"
    : "edit";
}

export function toolCallToAgentAction(toolCall: ModelToolCall): ExecutableAgentAction {
  if (!isToolName(toolCall.name)) {
    return invalidToolAction(toolCall, `Unsupported native tool name: ${toolCall.name}`);
  }

  let input: Record<string, unknown>;
  try {
    input = readToolInput(toolCall.input);
  } catch (error) {
    return invalidToolAction(toolCall, formatError(error));
  }

  try {
    return readKnownToolCall(toolCall.name, input);
  } catch (error) {
    return invalidToolAction(toolCall, formatError(error));
  }
}

function readKnownToolCall(name: ToolName, input: Record<string, unknown>): ExecutableAgentAction {
  switch (name) {
    case "read":
      return { type: "read", path: readString(input, "path") };
    case "glob":
      return { type: "glob", pattern: readString(input, "pattern") };
    case "grep":
      return readGrepAction(input);
    case "apply_patch":
      return { type: "apply_patch", patchText: readString(input, "patchText") };
    case "webfetch":
      return readWebfetchAction(input);
    case "todowrite":
      return { type: "todowrite", todos: readArray(input, "todos") };
    case "question":
      return { type: "question", questions: readArray(input, "questions") };
    case "skill":
      return { type: "skill", name: readString(input, "name") };
    case "task":
      return readTaskAction(input);
    case "plan_exit":
      return { type: "plan_exit" };
    case "edit":
      return readEditAction(input);
    case "write":
      return {
        type: "write",
        filePath: readString(input, "filePath"),
        content: readStringAllowEmpty(input, "content"),
      };
    case "bash":
      return { type: "verify", command: readString(input, "command") };
  }
}

function invalidToolAction(toolCall: ModelToolCall, reason: string): ExecutableAgentAction {
  return {
    type: "invalid_tool",
    toolName: toolCall.name,
    reason,
    input: toolCall.input,
  };
}

function isToolName(value: string): value is ToolName {
  return (
    value === "read" ||
    value === "glob" ||
    value === "grep" ||
    value === "edit" ||
    value === "write" ||
    value === "apply_patch" ||
    value === "bash" ||
    value === "webfetch" ||
    value === "todowrite" ||
    value === "question" ||
    value === "skill" ||
    value === "task" ||
    value === "plan_exit"
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readTaskAction(input: Record<string, unknown>): ExecutableAgentAction {
  const taskId = readOptionalString(input, "task_id");
  const command = readOptionalString(input, "command");

  return {
    type: "task",
    description: readString(input, "description"),
    prompt: readString(input, "prompt"),
    subagent_type: readString(input, "subagent_type"),
    ...(taskId === undefined ? {} : { task_id: taskId }),
    ...(command === undefined ? {} : { command }),
  };
}

function readWebfetchAction(input: Record<string, unknown>): ExecutableAgentAction {
  const format = readOptionalString(input, "format");
  const timeout = readOptionalNumber(input, "timeout");

  if (format !== undefined && format !== "text" && format !== "markdown" && format !== "html") {
    throw new Error("Native tool input field format must be text, markdown, or html");
  }

  return {
    type: "webfetch",
    url: readString(input, "url"),
    ...(format === undefined ? {} : { format }),
    ...(timeout === undefined ? {} : { timeout }),
  };
}

function readGrepAction(input: Record<string, unknown>): ExecutableAgentAction {
  const include = readOptionalString(input, "include");

  return {
    type: "grep",
    pattern: readString(input, "pattern"),
    ...(include === undefined ? {} : { include }),
  };
}

function readEditAction(input: Record<string, unknown>): ExecutableAgentAction {
  const replaceAll = readOptionalBoolean(input, "replaceAll");

  return {
    type: "edit",
    filePath: readString(input, "filePath"),
    oldString: readStringAllowEmpty(input, "oldString"),
    newString: readStringAllowEmpty(input, "newString"),
    ...(replaceAll === undefined ? {} : { replaceAll }),
  };
}

function readToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Native tool input must be an object.");
  }

  return input as Record<string, unknown>;
}

function readString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Native tool input requires string field: ${field}`);
  }

  return value;
}

function readStringAllowEmpty(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string") {
    throw new Error(`Native tool input requires string field: ${field}`);
  }

  return value;
}

function readOptionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];

  if (value === undefined) return undefined;

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Native tool input field must be a non-empty string: ${field}`);
  }

  return value;
}

function readOptionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];

  if (value === undefined) return undefined;

  if (typeof value !== "boolean") {
    throw new Error(`Native tool input field must be a boolean: ${field}`);
  }

  return value;
}

function readOptionalNumber(input: Record<string, unknown>, field: string): number | undefined {
  const value = input[field];

  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Native tool input field must be a number: ${field}`);
  }

  return value;
}

function readArray(input: Record<string, unknown>, field: string): unknown[] {
  const value = input[field];

  if (!Array.isArray(value)) {
    throw new Error(`Native tool input field must be an array: ${field}`);
  }

  return value;
}
