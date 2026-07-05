import type { ExecutableAgentAction } from "./actions.js";

export function formatInvalidToolObservation(
  action: Extract<ExecutableAgentAction, { type: "invalid_tool" }>,
): string {
  return [
    `Invalid native tool call: ${action.toolName}`,
    `Reason: ${action.reason}`,
    "Do not repeat this malformed tool call. Choose a valid available tool with valid input, or finish with the available observations.",
  ].join("\n");
}
