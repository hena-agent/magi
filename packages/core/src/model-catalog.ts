import { getAuth, isOAuthAuth } from "./auth.js";
import type { ModelsDevCatalog, ModelsDevModel, ModelsDevProvider } from "./models-dev.js";

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
  source: "config" | "builtin" | "models-dev";
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
  modelsDevCatalog?: ModelsDevCatalog;
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

  for (const provider of listModelsDevModelProviders(input.modelsDevCatalog ?? {})) {
    providers.set(provider.id, {
      ...provider,
      source: "models-dev",
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

export function listModelsDevModelProviders(catalog: ModelsDevCatalog): ModelProviderSettings[] {
  const providers: ModelProviderSettings[] = [];

  for (const provider of Object.values(catalog)) {
    const providerKind = toSupportedProviderKind(provider.id);
    if (!providerKind) continue;

    const model = selectDefaultModelsDevModel(provider);
    if (!model) continue;

    providers.push({
      id: provider.id,
      provider: providerKind,
      model: model.id,
      ...(provider.env[0] === undefined ? {} : { apiKeyEnv: provider.env[0] }),
      ...(provider.api === undefined ? {} : { baseUrl: provider.api }),
    });
  }

  return providers;
}

function toSupportedProviderKind(id: string): ModelProviderSettings["provider"] | undefined {
  if (id === "openai") return "openai";
  if (id === "anthropic") return "anthropic";
  if (id === "google") return "google";
  return undefined;
}

function selectDefaultModelsDevModel(provider: ModelsDevProvider): ModelsDevModel | undefined {
  const models = Object.values(provider.models).filter((model) => model.status !== "deprecated");
  const scored = models
    .map((model) => ({ model, score: scoreModelsDevModel(provider.id, model) }))
    .sort((left, right) => right.score - left.score || left.model.id.localeCompare(right.model.id));

  return scored[0]?.model;
}

function scoreModelsDevModel(providerId: string, model: ModelsDevModel): number {
  const text = `${providerId} ${model.id} ${model.name} ${model.family ?? ""}`.toLowerCase();
  let score = 0;

  if (model.tool_call) score += 10;
  if (model.reasoning) score += 3;
  if (/gpt-5|gpt-4\.1|codex/.test(text)) score += 20;
  if (/claude.*(sonnet|opus)|sonnet|opus/.test(text)) score += 20;
  if (/gemini.*pro|gemini-.*pro/.test(text)) score += 20;
  if (/mini|haiku|flash|nano|lite/.test(text)) score -= 5;
  if (model.status === "active" || model.status === undefined) score += 1;

  return score;
}
