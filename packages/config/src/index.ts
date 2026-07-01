import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ModelProviderConfig = {
  id: string;
  provider: "openai" | "deepseek" | "anthropic" | "google" | "custom";
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
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

type RawMagiConfig = {
  modelProviders?: ModelProviderConfig[];
  permissions?: Partial<PermissionConfig>;
  verificationCommands?: string[];
  agent?: Partial<AgentConfig>;
  session?: Partial<SessionConfig>;
};

const configFileNames = ["magi.config.json", ".magi/config.json"];

const defaultPermissions: PermissionConfig = {
  read: "allow",
  write: "prompt",
  shell: "prompt",
  network: "prompt",
};

const defaultAgent: AgentConfig = {
  maxIterations: 30,
};

const defaultSession: SessionConfig = {
  startup: "new",
};

export function getDefaultConfig(): MagiConfig {
  const workspaceRoot = findWorkspaceRoot(process.env.INIT_CWD ?? process.cwd());

  return {
    workspaceRoot,
    modelProviders: [],
    permissions: defaultPermissions,
    verificationCommands: ["pnpm typecheck", "pnpm test", "pnpm lint", "pnpm knip"],
    agent: defaultAgent,
    session: defaultSession,
  };
}

export function loadConfig(options: LoadConfigOptions = {}): MagiConfig {
  const workspaceRoot = findWorkspaceRoot(options.cwd ?? process.env.INIT_CWD ?? process.cwd());
  const baseConfig: MagiConfig = {
    ...getDefaultConfig(),
    workspaceRoot,
  };
  const configPath = options.configPath ?? findConfigPath(workspaceRoot);

  if (!configPath) {
    return baseConfig;
  }

  const rawConfig = parseConfigFile(configPath);

  return {
    workspaceRoot,
    modelProviders: rawConfig.modelProviders ?? baseConfig.modelProviders,
    permissions: {
      ...baseConfig.permissions,
      ...rawConfig.permissions,
    },
    verificationCommands: rawConfig.verificationCommands ?? baseConfig.verificationCommands,
    agent: {
      ...baseConfig.agent,
      ...rawConfig.agent,
    },
    session: {
      ...baseConfig.session,
      ...rawConfig.session,
    },
  };
}

function findConfigPath(workspaceRoot: string): string | undefined {
  for (const fileName of configFileNames) {
    const filePath = join(workspaceRoot, fileName);

    if (existsSync(filePath)) {
      return filePath;
    }
  }

  return undefined;
}

function parseConfigFile(configPath: string): RawMagiConfig {
  const parsedConfig = JSON.parse(readFileSync(configPath, "utf8")) as unknown;

  if (!isObject(parsedConfig)) {
    throw new Error(`MAGI config must be a JSON object: ${configPath}`);
  }

  return {
    modelProviders: readModelProviders(parsedConfig.modelProviders, configPath),
    permissions: readPermissions(parsedConfig.permissions, configPath),
    verificationCommands: readStringArray(
      parsedConfig.verificationCommands,
      "verificationCommands",
      configPath,
    ),
    agent: readAgentConfig(parsedConfig.agent, configPath),
    session: readSessionConfig(parsedConfig.session, configPath),
  };
}

function readAgentConfig(value: unknown, configPath: string): Partial<AgentConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw new Error(`agent must be an object: ${configPath}`);
  }

  const maxIterations = value.maxIterations;

  if (maxIterations === undefined) {
    return undefined;
  }

  if (typeof maxIterations !== "number" || !Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`agent.maxIterations must be a positive integer: ${configPath}`);
  }

  return { maxIterations };
}

function readSessionConfig(value: unknown, configPath: string): Partial<SessionConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw new Error(`session must be an object: ${configPath}`);
  }

  const startup = value.startup;

  if (startup === undefined) {
    return undefined;
  }

  if (startup !== "new" && startup !== "resume") {
    throw new Error(`session.startup must be new or resume: ${configPath}`);
  }

  return { startup };
}

function readModelProviders(value: unknown, configPath: string): ModelProviderConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`modelProviders must be an array: ${configPath}`);
  }

  return value.map((providerConfig, index) => {
    if (!isObject(providerConfig)) {
      throw new Error(`modelProviders[${index}] must be an object: ${configPath}`);
    }

    const { id, provider, model, apiKeyEnv, baseUrl } = providerConfig;

    if (!isNonEmptyString(id) || !isProvider(provider) || !isNonEmptyString(model)) {
      throw new Error(
        `modelProviders[${index}] must include id, provider, and model: ${configPath}`,
      );
    }

    if (apiKeyEnv !== undefined && !isNonEmptyString(apiKeyEnv)) {
      throw new Error(`modelProviders[${index}].apiKeyEnv must be a string: ${configPath}`);
    }

    if (baseUrl !== undefined && !isNonEmptyString(baseUrl)) {
      throw new Error(`modelProviders[${index}].baseUrl must be a string: ${configPath}`);
    }

    return {
      id,
      provider,
      model,
      ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
      ...(baseUrl === undefined ? {} : { baseUrl }),
    };
  });
}

function readPermissions(
  value: unknown,
  configPath: string,
): Partial<PermissionConfig> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isObject(value)) {
    throw new Error(`permissions must be an object: ${configPath}`);
  }

  const permissions: Partial<PermissionConfig> = {};

  for (const name of ["read", "write", "shell", "network"] as const) {
    const permission = readPermission(value[name], name, configPath);

    if (permission !== undefined) {
      permissions[name] = permission;
    }
  }

  return permissions;
}

function readPermission(
  value: unknown,
  name: keyof PermissionConfig,
  configPath: string,
): PermissionPolicy | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "allow" && value !== "prompt" && value !== "deny") {
    throw new Error(`permissions.${name} must be allow, prompt, or deny: ${configPath}`);
  }

  return value;
}

function readStringArray(value: unknown, name: string, configPath: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => !isNonEmptyString(item))) {
    throw new Error(`${name} must be an array of strings: ${configPath}`);
  }

  return value;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProvider(value: unknown): value is ModelProviderConfig["provider"] {
  return (
    value === "openai" ||
    value === "deepseek" ||
    value === "anthropic" ||
    value === "google" ||
    value === "custom"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function findWorkspaceRoot(startPath: string): string {
  let currentPath = startPath;

  while (true) {
    if (existsSync(join(currentPath, "pnpm-workspace.yaml"))) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      return startPath;
    }

    currentPath = parentPath;
  }
}
