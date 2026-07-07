export type SlashCommandInfo = {
  name: string;
  usage: string;
  description: string;
  category?: string;
  aliases?: string[];
  hidden?: boolean;
};

export const slashCommands: SlashCommandInfo[] = [
  {
    name: "model",
    usage: "/model [provider-id|status|reset]",
    description: "List or switch AI models",
    category: "Model/Auth",
  },
  {
    name: "mode",
    usage: "/mode",
    description: "Show current MAGI mode, agent, model, and session",
    category: "Workflow",
  },
  {
    name: "auth",
    usage: "/auth status|login|refresh|logout openai",
    description: "Manage OpenAI OAuth auth",
    category: "Model/Auth",
  },
  {
    name: "agent",
    usage: "/agent [agent-id]",
    description: "List or switch agents",
    category: "Agent",
  },
  {
    name: "plan",
    usage: "/plan [prompt]",
    description: "Switch to plan agent, optionally run prompt",
    category: "Agent",
  },
  {
    name: "build",
    usage: "/build [prompt]",
    description: "Switch to build agent, optionally run prompt",
    category: "Agent",
  },
  { name: "queue", usage: "/queue", description: "Show queued prompts", category: "Workflow" },
  {
    name: "clear_queue",
    usage: "/clear_queue",
    description: "Clear queued prompts",
    category: "Workflow",
  },
  {
    name: "steer",
    usage: "/steer <message>",
    description: "Add steering input for the next run",
    category: "Workflow",
  },
  {
    name: "interrupt",
    usage: "/interrupt",
    description: "Stop the current run at the next safe point",
    category: "Workflow",
  },
  {
    name: "verify",
    usage: "/verify [command]",
    description: "Run verification command",
    category: "Workflow",
  },
  {
    name: "revise",
    usage: "/revise",
    description: "Revise from recent verification failures",
    category: "Workflow",
  },
  {
    name: "summary",
    usage: "/summary",
    description: "Summarize the workspace",
    category: "Session",
  },
  {
    name: "sessions",
    usage: "/sessions [all]",
    description: "List recent sessions",
    category: "Session",
  },
  {
    name: "resume",
    usage: "/resume <session-id|number>",
    description: "Resume a saved session",
    category: "Session",
  },
  { name: "new", usage: "/new", description: "Start a new draft session", category: "Session" },
  {
    name: "rename",
    usage: "/rename <title>",
    description: "Rename the current session",
    category: "Session",
  },
  {
    name: "history",
    usage: "/history [limit]",
    description: "Show session event history",
    category: "Session",
  },
  { name: "read", usage: "/read <path>", description: "Read a workspace file", hidden: true },
  {
    name: "glob",
    usage: "/glob <pattern>",
    description: "List files matching a glob",
    hidden: true,
  },
  {
    name: "grep",
    usage: "/grep <pattern> [include]",
    description: "Search workspace files",
    hidden: true,
  },
  {
    name: "webfetch",
    usage: "/webfetch <url> [format]",
    description: "Fetch web content",
    hidden: true,
  },
  {
    name: "websearch",
    usage: "/websearch [provider] <query>",
    description: "Search the web with Exa, Parallel, or Brave",
    hidden: true,
  },
  {
    name: "todowrite",
    usage: "/todowrite <json>",
    description: "Update session todo list",
    hidden: true,
  },
  {
    name: "question",
    usage: "/question <json>",
    description: "Ask structured questions",
    hidden: true,
  },
  { name: "skill", usage: "/skill <name>", description: "Load a named skill", hidden: true },
  {
    name: "lsp_symbols",
    usage: "/lsp_symbols <file>",
    description: "List document symbols",
    hidden: true,
  },
  {
    name: "lsp_definition",
    usage: "/lsp_definition <file> <line> <character>",
    description: "Find symbol definitions",
    hidden: true,
  },
  {
    name: "lsp_references",
    usage: "/lsp_references <file> <line> <character>",
    description: "Find symbol references",
    hidden: true,
  },
  {
    name: "lsp_hover",
    usage: "/lsp_hover <file> <line> <character>",
    description: "Show hover/type info",
    hidden: true,
  },
  {
    name: "lsp_call_hierarchy",
    usage: "/lsp_call_hierarchy <file> <line> <character> [incoming|outgoing|both]",
    description: "Show symbol call hierarchy",
    hidden: true,
  },
  {
    name: "bash",
    usage: "/bash <command>",
    description: "Run a shell command with permission",
    hidden: true,
  },
  {
    name: "apply_patch",
    usage: "/apply_patch <patch-file>",
    description: "Apply a patch file",
    hidden: true,
  },
  {
    name: "apply_last_patch",
    usage: "/apply_last_patch",
    description: "Apply latest proposed patch",
    hidden: true,
  },
  {
    name: "magi_preview",
    usage: "/magi_preview",
    description: "Preview MAGI consensus context",
    hidden: true,
  },
  {
    name: "maintain_sessions",
    usage: "/maintain_sessions",
    description: "Generate missing titles/summaries",
    hidden: true,
  },
  {
    name: "session_cleanup_candidates",
    usage: "/session_cleanup_candidates",
    description: "Show sessions that look safe to clean up",
    hidden: true,
  },
  { name: "help", usage: "/help", description: "Show command list", category: "Workflow" },
];

export const visibleSlashCommands = slashCommands.filter((command) => command.hidden !== true);

export function getSlashCommandSuggestions(input: string): SlashCommandInfo[] {
  if (!input.startsWith("/")) {
    return [];
  }

  const rawQuery = input.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (rawQuery.length > 0 && input.length > rawQuery.length + 1) return [];
  if (visibleSlashCommands.some((command) => command.name.toLowerCase() === rawQuery)) return [];

  if (rawQuery.length === 0) {
    return visibleSlashCommands.slice(0, 8);
  }

  return visibleSlashCommands
    .filter((command) => {
      const names = [command.name, ...(command.aliases ?? [])];
      return names.some((name) => name.toLowerCase().startsWith(rawQuery));
    })
    .slice(0, 8);
}

export function formatSlashCommandCompletion(command: SlashCommandInfo): string {
  return `/${command.name} `;
}

export function formatSlashCommandHelp(commands: SlashCommandInfo[]): string {
  const categories = ["Session", "Model/Auth", "Agent", "Workflow", "MAGI", "Tools"];
  const lines = ["Commands:"];

  for (const category of categories) {
    const categoryCommands = commands.filter(
      (command) => (command.category ?? "Tools") === category,
    );
    if (categoryCommands.length === 0) continue;

    lines.push("", `${category}:`);
    lines.push(...categoryCommands.map((command) => `${command.usage} - ${command.description}`));
  }

  return lines.join("\n");
}
