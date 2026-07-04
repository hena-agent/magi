import type { ExecutableAgentAction } from "./actions.js";

export function formatObservation(action: ExecutableAgentAction, observation: string): string {
  return [`Action: ${action.type}`, "Observation:", truncateObservation(observation)].join("\n");
}

export function truncateObservation(value: string): string {
  return value.length > 6_000
    ? `[truncated ${value.length - 6_000} chars]\n${value.slice(-6_000)}`
    : value;
}

export function getActionKey(action: ExecutableAgentAction): string {
  switch (action.type) {
    case "read":
      return `read:${action.path}`;
    case "glob":
      return `glob:${action.pattern}`;
    case "grep":
      return `grep:${action.pattern}:${action.include ?? ""}`;
    case "edit":
      return `edit:${action.filePath}:${action.oldString}:${action.newString}:${action.replaceAll ?? false}`;
    case "write":
      return `write:${action.filePath}:${action.content}`;
    case "apply_patch":
      return `apply_patch:${action.patchText}`;
    case "verify":
      return `verify:${action.command ?? ""}`;
    case "propose_patch":
      return `propose_patch:${action.patch}`;
  }
}
