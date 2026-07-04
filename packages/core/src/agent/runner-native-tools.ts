import type { ToolCall } from "../tools.js";
import type { ExecutableAgentAction } from "./actions.js";
import type { AgentInfo } from "./registry.js";

const readNativeToolDefinitions = [
  {
    name: "read" as const,
    description: "Read a UTF-8 text file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "glob" as const,
    description: "List workspace files matching a glob pattern.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "grep" as const,
    description: "Search workspace file contents using a regular expression.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, include: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
];

const editNativeToolDefinitions = [
  {
    name: "edit" as const,
    description:
      "Perform an exact string replacement in a workspace file. Prefer after reading the file. Use replaceAll only when all occurrences should change.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["filePath", "oldString", "newString"],
      additionalProperties: false,
    },
  },
  {
    name: "write" as const,
    description: "Write full content to a workspace file. Prefer edit for existing files.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
  },
];

const patchNativeToolDefinitions = [
  {
    name: "apply_patch" as const,
    description:
      "Apply an OpenCode-style patch envelope with *** Begin Patch / *** End Patch and Add/Delete/Update file sections.",
    inputSchema: {
      type: "object",
      properties: { patchText: { type: "string" } },
      required: ["patchText"],
      additionalProperties: false,
    },
  },
];

export function getNativeToolDefinitions(agent: AgentInfo, model: string | undefined) {
  return [
    ...(agent.permission.read === "deny" ? [] : readNativeToolDefinitions),
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

export function toolCallToAgentAction(toolCall: ToolCall): ExecutableAgentAction {
  const input = readToolInput(toolCall.input);

  switch (toolCall.name) {
    case "read":
      return { type: "read", path: readString(input, "path") };
    case "glob":
      return { type: "glob", pattern: readString(input, "pattern") };
    case "grep":
      return readGrepAction(input);
    case "apply_patch":
      return { type: "apply_patch", patchText: readString(input, "patchText") };
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
