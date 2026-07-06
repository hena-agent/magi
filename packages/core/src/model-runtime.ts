import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { OAUTH_DUMMY_KEY } from "./auth.js";
import type { ModelProviderSettings } from "./model-catalog.js";
import { createOpenAICodexOAuthFetch, isOpenAICodexOAuthModel } from "./openai-codex-oauth.js";

const defaultDeepSeekBaseUrl = "https://api.deepseek.com";

export type ModelRuntimeCredentials = {
  apiKeyEnv?: string;
  apiKey?: string;
  isOAuth: boolean;
};

export function resolveModelRuntimeCredentials(
  providerConfig: ModelProviderSettings,
): ModelRuntimeCredentials {
  const isOAuth = providerConfig.provider === "openai" && providerConfig.auth?.type === "oauth";
  const apiKeyEnv = providerConfig.apiKeyEnv ?? getDefaultApiKeyEnv(providerConfig.provider);
  const apiKey = isOAuth ? OAUTH_DUMMY_KEY : apiKeyEnv ? process.env[apiKeyEnv] : undefined;

  return {
    ...(apiKeyEnv === undefined ? {} : { apiKeyEnv }),
    ...(apiKey === undefined ? {} : { apiKey }),
    isOAuth,
  };
}

export async function resolveLanguageModel(input: {
  providerConfig: ModelProviderSettings;
  apiKey?: string;
  workspaceRoot?: string;
  sessionId?: string;
}): Promise<LanguageModel> {
  switch (input.providerConfig.provider) {
    case "openai":
    case "deepseek":
    case "custom":
      return resolveOpenAICompatibleLanguageModel(input);
    case "anthropic":
      return resolveAnthropicLanguageModel(input);
    case "google":
      return resolveGoogleLanguageModel(input);
  }
}

export function getProviderBaseUrl(providerConfig: ModelProviderSettings): string | undefined {
  if (providerConfig.baseUrl !== undefined) {
    return providerConfig.baseUrl;
  }

  if (providerConfig.provider === "deepseek") {
    return defaultDeepSeekBaseUrl;
  }

  return undefined;
}

export function getDefaultApiKeyEnv(
  provider: ModelProviderSettings["provider"],
): string | undefined {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "custom":
      return undefined;
  }
}

function resolveOpenAICompatibleLanguageModel(input: {
  providerConfig: ModelProviderSettings;
  apiKey?: string;
  workspaceRoot?: string;
  sessionId?: string;
}): LanguageModel {
  const providerConfig = input.providerConfig;
  const baseURL = getProviderBaseUrl(providerConfig);
  const isOAuth = providerConfig.provider === "openai" && providerConfig.auth?.type === "oauth";
  const provider = createOpenAI({
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(isOAuth && input.workspaceRoot
      ? {
          fetch: createOpenAICodexOAuthFetch({
            workspaceRoot: input.workspaceRoot,
            sessionId: input.sessionId,
          }),
        }
      : {}),
    ...(shouldUseChatCompletions(providerConfig.provider) ? { name: providerConfig.provider } : {}),
  });

  if (providerConfig.provider === "openai" && isOpenAICodexOAuthModel(providerConfig.model)) {
    return provider.responses(providerConfig.model);
  }

  if (shouldUseChatCompletions(providerConfig.provider)) {
    return provider.chat(providerConfig.model);
  }

  return provider(providerConfig.model);
}

async function resolveAnthropicLanguageModel(input: {
  providerConfig: ModelProviderSettings;
  apiKey?: string;
}): Promise<LanguageModel> {
  const mod = await import("@ai-sdk/anthropic");
  const provider = mod.createAnthropic({
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.providerConfig.baseUrl === undefined
      ? {}
      : { baseURL: input.providerConfig.baseUrl }),
    name: input.providerConfig.id,
    headers: {
      "anthropic-beta": "interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14",
    },
  });

  return provider(input.providerConfig.model);
}

async function resolveGoogleLanguageModel(input: {
  providerConfig: ModelProviderSettings;
  apiKey?: string;
}): Promise<LanguageModel> {
  const mod = await import("@ai-sdk/google");
  const provider = mod.createGoogleGenerativeAI({
    ...(input.apiKey === undefined ? {} : { apiKey: input.apiKey }),
    ...(input.providerConfig.baseUrl === undefined
      ? {}
      : { baseURL: input.providerConfig.baseUrl }),
    name: input.providerConfig.id,
  });

  return provider(input.providerConfig.model);
}

function shouldUseChatCompletions(provider: ModelProviderSettings["provider"]): boolean {
  return provider === "deepseek" || provider === "custom";
}
