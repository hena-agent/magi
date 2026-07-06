export type AgentProcessId =
  | "spec"
  | "validate"
  | "compose"
  | "execute"
  | "verify"
  | "test"
  | "harness"
  | "done";

const agentProcessIds: Record<string, AgentProcessId[]> = {
  plan: ["spec", "validate", "compose", "done"],
  build: ["execute", "verify", "test", "harness", "done"],
};

export function listAgentProcesses(agentId: string): AgentProcessId[] {
  return [...(agentProcessIds[agentId] ?? [])];
}

export function getDefaultAgentProcess(agentId: string): AgentProcessId | undefined {
  return agentProcessIds[agentId]?.[0];
}
