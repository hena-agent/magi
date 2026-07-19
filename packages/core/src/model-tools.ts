import { jsonSchema } from "ai";
import type { ModelToolCall, ModelToolDefinition } from "./model.js";

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
): ModelToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: String(toolCall.toolName),
    input: toolCall.input,
  }));
}
