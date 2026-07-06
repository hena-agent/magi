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
    case "webfetch":
      return `webfetch:${action.url}:${action.format ?? "markdown"}`;
    case "websearch":
      return `websearch:${action.providerId ?? "auto"}:${action.query}`;
    case "todowrite":
      return `todowrite:${JSON.stringify(action.todos)}`;
    case "question":
      return `question:${JSON.stringify(action.questions)}`;
    case "skill":
      return `skill:${action.name}`;
    case "lsp_symbols":
      return `lsp_symbols:${action.filePath}`;
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover":
      return `${action.type}:${action.filePath}:${action.line}:${action.character}`;
    case "lsp_call_hierarchy":
      return `${action.type}:${action.filePath}:${action.line}:${action.character}:${action.direction ?? "both"}`;
    case "task":
      return `task:${action.background === true ? "background" : "foreground"}:${action.subagent_type}:${action.prompt}`;
    case "plan_exit":
      return "plan_exit";
    case "invalid_tool":
      return `invalid_tool:${action.toolName}:${action.reason}:${JSON.stringify(action.input)}`;
    case "verify":
      return `verify:${action.command ?? ""}`;
    case "propose_patch":
      return `propose_patch:${action.patch}`;
  }
}
