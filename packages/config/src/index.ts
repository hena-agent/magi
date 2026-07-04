import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseConfigFile } from "./parse.js";
import type {
  AgentConfig,
  LoadConfigOptions,
  MagiConfig,
  PermissionConfig,
  SessionConfig,
} from "./types.js";
import { findWorkspaceRoot } from "./workspace.js";

export type {
  AgentConfig,
  LoadConfigOptions,
  MagiConfig,
  ModelProviderAuthConfig,
  ModelProviderConfig,
  PermissionConfig,
  PermissionPolicy,
  SessionConfig,
} from "./types.js";

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
