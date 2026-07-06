export type AgentCommandId = "plan" | "build" | "done";

export type AgentCommandKind = "agent_turn" | "checkpoint";

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
  done: {
    id: "done",
    slash: "/done",
    usage: "/done",
    description: "Show a final checkpoint for the current agent",
    kind: "checkpoint",
  },
} satisfies Record<AgentCommandId, AgentCommandInfo>;

const agentCommandIds: Record<string, AgentCommandId[]> = {
  plan: ["plan", "done"],
  build: ["plan", "build", "done"],
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
