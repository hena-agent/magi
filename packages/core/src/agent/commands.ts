export type AgentCommandId = "plan" | "build" | "validate" | "verify" | "test" | "harness" | "done";

export type AgentCommandKind =
  | "agent_turn"
  | "validation"
  | "verification"
  | "test"
  | "harness"
  | "checkpoint";

export type AgentCommandInfo = {
  id: AgentCommandId;
  slash: `/${AgentCommandId}`;
  usage: string;
  description: string;
  kind: AgentCommandKind;
};

const commandDefinitions = {
  plan: {
    id: "plan",
    slash: "/plan",
    usage: "/plan [prompt]",
    description: "Create or refine a plan",
    kind: "agent_turn",
  },
  build: {
    id: "build",
    slash: "/build",
    usage: "/build [task]",
    description: "Implement using the build agent",
    kind: "agent_turn",
  },
  validate: {
    id: "validate",
    slash: "/validate",
    usage: "/validate [focus]",
    description: "Check whether the current plan or implementation is logically ready",
    kind: "validation",
  },
  verify: {
    id: "verify",
    slash: "/verify",
    usage: "/verify [command]",
    description: "Run deterministic verification commands",
    kind: "verification",
  },
  test: {
    id: "test",
    slash: "/test",
    usage: "/test [core|tui|config|harness|all]",
    description: "Run a focused known test target",
    kind: "test",
  },
  harness: {
    id: "harness",
    slash: "/harness",
    usage: "/harness [suite]",
    description: "Run a product/scenario harness suite when configured",
    kind: "harness",
  },
  done: {
    id: "done",
    slash: "/done",
    usage: "/done",
    description: "Show a final checkpoint for the current agent",
    kind: "checkpoint",
  },
} satisfies Record<AgentCommandId, AgentCommandInfo>;

const agentCommandIds: Record<string, AgentCommandId[]> = {
  plan: ["plan", "validate", "done"],
  build: ["plan", "build", "validate", "verify", "test", "harness", "done"],
};

export function listAgentCommands(agentId: string): AgentCommandInfo[] {
  return (agentCommandIds[agentId] ?? []).map((commandId) => commandDefinitions[commandId]);
}

export function getAgentCommand(agentId: string, commandId: string): AgentCommandInfo | undefined {
  return listAgentCommands(agentId).find((command) => command.id === commandId);
}

export function listAgentCommandIds(agentId: string): AgentCommandId[] {
  return [...(agentCommandIds[agentId] ?? [])];
}
