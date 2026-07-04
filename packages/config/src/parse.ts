import { readFileSync } from "node:fs";
import type {
  AgentConfig,
  ModelProviderAuthConfig,
  ModelProviderConfig,
  PermissionConfig,
  PermissionPolicy,
  RawMagiConfig,
  SessionConfig,
} from "./types.js";

export function parseConfigFile(configPath: string): RawMagiConfig {
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
  if (value === undefined) return undefined;

  if (!isObject(value)) {
    throw new Error(`agent must be an object: ${configPath}`);
  }

  const maxIterations = value.maxIterations;

  if (maxIterations === undefined) return undefined;

  if (typeof maxIterations !== "number" || !Number.isInteger(maxIterations) || maxIterations < 1) {
    throw new Error(`agent.maxIterations must be a positive integer: ${configPath}`);
  }

  return { maxIterations };
}

function readSessionConfig(value: unknown, configPath: string): Partial<SessionConfig> | undefined {
  if (value === undefined) return undefined;

  if (!isObject(value)) {
    throw new Error(`session must be an object: ${configPath}`);
  }

  const startup = value.startup;

  if (startup === undefined) return undefined;

  if (startup !== "new" && startup !== "resume") {
    throw new Error(`session.startup must be new or resume: ${configPath}`);
  }

  return { startup };
}

function readModelProviders(value: unknown, configPath: string): ModelProviderConfig[] | undefined {
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) {
    throw new Error(`modelProviders must be an array: ${configPath}`);
  }

  return value.map((providerConfig, index) => readModelProvider(providerConfig, index, configPath));
}

function readModelProvider(
  providerConfig: unknown,
  index: number,
  configPath: string,
): ModelProviderConfig {
  if (!isObject(providerConfig)) {
    throw new Error(`modelProviders[${index}] must be an object: ${configPath}`);
  }

  const { id, provider, model, auth } = providerConfig;

  if (!isNonEmptyString(id) || !isProvider(provider) || !isNonEmptyString(model)) {
    throw new Error(`modelProviders[${index}] must include id, provider, and model: ${configPath}`);
  }

  const apiKeyEnv = readOptionalString(
    providerConfig.apiKeyEnv,
    `modelProviders[${index}].apiKeyEnv`,
    configPath,
  );
  const baseUrl = readOptionalString(
    providerConfig.baseUrl,
    `modelProviders[${index}].baseUrl`,
    configPath,
  );

  const parsedAuth = readModelProviderAuth(auth, `modelProviders[${index}].auth`, configPath);

  if (parsedAuth?.type === "oauth" && provider !== "openai") {
    throw new Error(
      `modelProviders[${index}].auth.type oauth is only supported for openai: ${configPath}`,
    );
  }

  return {
    id,
    provider,
    model,
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(parsedAuth === undefined ? {} : { auth: parsedAuth }),
  };
}

function readOptionalString(value: unknown, path: string, configPath: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isNonEmptyString(value)) {
    throw new Error(`${path} must be a string: ${configPath}`);
  }

  return value;
}

function readModelProviderAuth(
  value: unknown,
  path: string,
  configPath: string,
): ModelProviderAuthConfig | undefined {
  if (value === undefined) return undefined;

  if (!isObject(value)) {
    throw new Error(`${path} must be an object: ${configPath}`);
  }

  if (value.type !== "oauth") {
    throw new Error(`${path}.type must be oauth: ${configPath}`);
  }

  return { type: "oauth" };
}

function readPermissions(
  value: unknown,
  configPath: string,
): Partial<PermissionConfig> | undefined {
  if (value === undefined) return undefined;

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
  if (value === undefined) return undefined;

  if (value !== "allow" && value !== "prompt" && value !== "deny") {
    throw new Error(`permissions.${name} must be allow, prompt, or deny: ${configPath}`);
  }

  return value;
}

function readStringArray(value: unknown, name: string, configPath: string): string[] | undefined {
  if (value === undefined) return undefined;

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
