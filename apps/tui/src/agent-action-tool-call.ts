import { createToolCall, type ExecutableAgentAction, type ToolCall } from "@magi/core";

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: One auditable switch mirrors the action union.
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: One auditable switch mirrors the action union.
export function createToolCallForExecutableAction(
  action: ExecutableAgentAction,
  options: { verificationCommands?: string[] } = {},
): ToolCall | undefined {
  const actionToolCall = (name: Parameters<typeof createToolCall>[0], input: unknown) =>
    createToolCall(name, input, action.toolCallId);

  switch (action.type) {
    case "read":
      return actionToolCall("read", { path: action.path });
    case "glob":
      return actionToolCall("glob", { pattern: action.pattern });
    case "grep":
      return actionToolCall("grep", {
        pattern: action.pattern,
        ...(action.include === undefined ? {} : { include: action.include }),
      });
    case "edit":
      return actionToolCall("edit", {
        filePath: action.filePath,
        oldString: action.oldString,
        newString: action.newString,
        ...(action.replaceAll === undefined ? {} : { replaceAll: action.replaceAll }),
      });
    case "write":
      return actionToolCall("write", { filePath: action.filePath, content: action.content });
    case "apply_patch":
      return actionToolCall("apply_patch", { patchText: action.patchText });
    case "webfetch":
      return actionToolCall("webfetch", {
        url: action.url,
        ...(action.format === undefined ? {} : { format: action.format }),
        ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
      });
    case "websearch":
      return actionToolCall("websearch", {
        query: action.query,
        ...(action.providerId === undefined ? {} : { providerId: action.providerId }),
        ...(action.limit === undefined ? {} : { limit: action.limit }),
        ...(action.searchType === undefined ? {} : { type: action.searchType }),
        ...(action.livecrawl === undefined ? {} : { livecrawl: action.livecrawl }),
        ...(action.contextMaxCharacters === undefined
          ? {}
          : { contextMaxCharacters: action.contextMaxCharacters }),
      });
    case "todowrite":
      return actionToolCall("todowrite", { todos: action.todos });
    case "skill":
      return actionToolCall("skill", { name: action.name });
    case "lsp_symbols":
      return actionToolCall("lsp_symbols", { filePath: action.filePath });
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover":
    case "lsp_call_hierarchy":
      return actionToolCall(action.type, {
        filePath: action.filePath,
        line: action.line,
        character: action.character,
        ...(action.type === "lsp_call_hierarchy" && action.direction !== undefined
          ? { direction: action.direction }
          : {}),
      });
    case "verify": {
      const command = action.command?.trim() || options.verificationCommands?.join(" && ");
      return command ? actionToolCall("bash", { command }) : undefined;
    }
    case "question":
    case "task":
    case "plan_exit":
    case "propose_patch":
    case "invalid_tool":
      return undefined;
  }
}
