import {
  MAGI_BUILD_PROMPT,
  MAGI_COMPACTION_PROMPT,
  MAGI_EXPLORE_PROMPT,
  MAGI_SUMMARY_PROMPT,
  MAGI_TITLE_PROMPT,
} from "./prompts.js";

export type AgentMode = "primary" | "subagent" | "system";

export type AgentPermissionPolicy = "allow" | "prompt" | "deny";

export type AgentPermissionConfig = {
  read: AgentPermissionPolicy;
  write: AgentPermissionPolicy;
  shell: AgentPermissionPolicy;
  network: AgentPermissionPolicy;
};

export type AgentInfo = {
  id: string;
  description: string;
  mode: AgentMode;
  native: boolean;
  hidden?: boolean;
  prompt: string;
  steps?: number;
  permission: AgentPermissionConfig;
};

const buildPermission = {
  read: "allow",
  write: "prompt",
  shell: "prompt",
  network: "prompt",
} satisfies AgentPermissionConfig;

const readOnlyPermission = {
  read: "allow",
  write: "deny",
  shell: "deny",
  network: "deny",
} satisfies AgentPermissionConfig;

const noToolPermission = {
  read: "deny",
  write: "deny",
  shell: "deny",
  network: "deny",
} satisfies AgentPermissionConfig;

export const builtinAgents: Record<string, AgentInfo> = {
  build: {
    id: "build",
    description:
      "Default development agent with write and shell actions gated by permission prompts.",
    mode: "primary",
    native: true,
    prompt: MAGI_BUILD_PROMPT,
    permission: buildPermission,
  },
  plan: {
    id: "plan",
    description: "Read-only planning and analysis agent.",
    mode: "primary",
    native: true,
    prompt: MAGI_BUILD_PROMPT,
    permission: readOnlyPermission,
  },
  general: {
    id: "general",
    description: "General-purpose subagent for complex research and multi-step work.",
    mode: "subagent",
    native: true,
    prompt: MAGI_BUILD_PROMPT,
    permission: buildPermission,
  },
  explore: {
    id: "explore",
    description: "Fast read-only codebase exploration subagent.",
    mode: "subagent",
    native: true,
    prompt: MAGI_EXPLORE_PROMPT,
    steps: 8,
    permission: readOnlyPermission,
  },
  compaction: {
    id: "compaction",
    description: "Hidden context compaction agent.",
    mode: "system",
    native: true,
    hidden: true,
    prompt: MAGI_COMPACTION_PROMPT,
    steps: 1,
    permission: noToolPermission,
  },
  title: {
    id: "title",
    description: "Hidden session title generation agent.",
    mode: "system",
    native: true,
    hidden: true,
    prompt: MAGI_TITLE_PROMPT,
    steps: 1,
    permission: noToolPermission,
  },
  summary: {
    id: "summary",
    description: "Hidden session summary generation agent.",
    mode: "system",
    native: true,
    hidden: true,
    prompt: MAGI_SUMMARY_PROMPT,
    steps: 1,
    permission: noToolPermission,
  },
};

export function listAgents(input: { includeHidden?: boolean } = {}): AgentInfo[] {
  return Object.values(builtinAgents).filter(
    (agent) => input.includeHidden || agent.hidden !== true,
  );
}

export function listPrimaryAgents(): AgentInfo[] {
  return listAgents().filter((agent) => agent.mode === "primary");
}

export function getDefaultAgent(): AgentInfo {
  const agent = builtinAgents.build;

  if (!agent) {
    throw new Error("Built-in build agent is missing.");
  }

  return agent;
}

export function getAgent(agentId: string): AgentInfo | undefined {
  return builtinAgents[agentId as keyof typeof builtinAgents];
}

export function mergeAgentPermission(
  agent: AgentInfo,
  globalPermission: AgentPermissionConfig,
): AgentPermissionConfig {
  return {
    read: mergePermission(agent.permission.read, globalPermission.read),
    write: mergePermission(agent.permission.write, globalPermission.write),
    shell: mergePermission(agent.permission.shell, globalPermission.shell),
    network: mergePermission(agent.permission.network, globalPermission.network),
  };
}

function mergePermission(
  agentPolicy: AgentPermissionPolicy,
  globalPolicy: AgentPermissionPolicy,
): AgentPermissionPolicy {
  if (agentPolicy === "deny" || globalPolicy === "deny") {
    return "deny";
  }

  if (agentPolicy === "prompt" || globalPolicy === "prompt") {
    return "prompt";
  }

  return "allow";
}
