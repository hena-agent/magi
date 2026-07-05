import { jsonSchema } from "ai";
import type { ToolCall, ToolName } from "./tools.js";
import type { ModelToolDefinition } from "./model.js";

export function formatToolDefinitions(tools: ModelToolDefinition[]) {
  return Object.fromEntries(
    tools.map((toolDefinition) => [
      toolDefinition.name,
      {
        description: toolDefinition.description,
        inputSchema: jsonSchema(toolDefinition.inputSchema),
      },
    ]),
  );
}

export function formatToolCalls(
  toolCalls: Array<{ toolName: unknown; toolCallId: string; input: unknown }>,
): ToolCall[] {
  return toolCalls.flatMap((toolCall) => {
    const name = String(toolCall.toolName);

    return isToolName(name) ? [{ id: toolCall.toolCallId, name, input: toolCall.input }] : [];
  });
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
