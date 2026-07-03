import { getAuth, isOAuthAuth } from "./auth.js";

export type ModelProviderAuthConfig = {
  type: "oauth";
};

export type ModelProviderSettings = {
  id: string;
  provider: "openai" | "deepseek" | "anthropic" | "google" | "custom";
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
  auth?: ModelProviderAuthConfig;
};

export type EffectiveModelProvider = ModelProviderSettings & {
  source: "config" | "builtin";
  authStatus?: "authenticated" | "login_required";
};

export const builtinModelProviders: ModelProviderSettings[] = [
  {
    id: "openai",
    provider: "openai",
    model: "gpt-5.5",
    auth: { type: "oauth" },
  },
  {
    id: "openai-gpt-5-4",
    provider: "openai",
    model: "gpt-5.4",
    auth: { type: "oauth" },
  },
  {
    id: "openai-gpt-5-4-mini",
    provider: "openai",
    model: "gpt-5.4-mini",
    auth: { type: "oauth" },
  },
  {
    id: "openai-gpt-5-3-codex-spark",
    provider: "openai",
    model: "gpt-5.3-codex-spark",
    auth: { type: "oauth" },
  },
];

export function listEffectiveModelProviders(input: {
  configProviders: ModelProviderSettings[];
  workspaceRoot?: string;
}): EffectiveModelProvider[] {
  const openaiAuth = input.workspaceRoot
    ? getAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai" })
    : undefined;
  const openaiAuthStatus = isOAuthAuth(openaiAuth) ? "authenticated" : "login_required";
  const providers = new Map<string, EffectiveModelProvider>();

  for (const provider of builtinModelProviders) {
    providers.set(provider.id, {
      ...provider,
      source: "builtin",
      authStatus: provider.auth?.type === "oauth" ? openaiAuthStatus : undefined,
    });
  }

  for (const provider of input.configProviders) {
    providers.set(provider.id, {
      ...provider,
      source: "config",
      authStatus: provider.auth?.type === "oauth" ? openaiAuthStatus : undefined,
    });
  }

  return [...providers.values()];
}
