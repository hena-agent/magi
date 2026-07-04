export type ModelProviderConfig = {
  id: string;
  provider: "openai" | "deepseek" | "anthropic" | "google" | "custom";
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  auth?: ModelProviderAuthConfig;
};

export type ModelProviderAuthConfig = {
  type: "oauth";
};

export type PermissionPolicy = "allow" | "prompt" | "deny";

export type PermissionConfig = {
  read: PermissionPolicy;
  write: PermissionPolicy;
  shell: PermissionPolicy;
  network: PermissionPolicy;
};

export type AgentConfig = {
  maxIterations: number;
};

export type SessionConfig = {
  startup: "new" | "resume";
};

export type MagiConfig = {
  workspaceRoot: string;
  modelProviders: ModelProviderConfig[];
  permissions: PermissionConfig;
  verificationCommands: string[];
  agent: AgentConfig;
  session: SessionConfig;
};

export type LoadConfigOptions = {
  cwd?: string;
  configPath?: string;
};

export type RawMagiConfig = {
  modelProviders?: ModelProviderConfig[];
  permissions?: Partial<PermissionConfig>;
  verificationCommands?: string[];
  agent?: Partial<AgentConfig>;
  session?: Partial<SessionConfig>;
};
