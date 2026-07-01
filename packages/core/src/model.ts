import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

type ModelProviderSettings = {
  id: string;
  provider: "openai" | "deepseek" | "anthropic" | "google" | "custom";
  model: string;
  apiKeyEnv?: string;
  baseUrl?: string;
};

type ModelAdapterConfig = {
  modelProviders: ModelProviderSettings[];
};

export type PrimaryModelAdapter = {
  generateText(input: { system?: string; prompt: string }): Promise<{ text: string }>;
};

const defaultSystemPrompt =
  "You are MAGI, a local coding assistant. Respond concisely. Do not claim tool results unless they are provided in the prompt.";

const defaultDeepSeekBaseUrl = "https://api.deepseek.com";

export function createPrimaryModelAdapter(config: ModelAdapterConfig): PrimaryModelAdapter {
  const providerConfig = config.modelProviders[0];

  if (!providerConfig) {
    throw new Error("No model provider configured. Add modelProviders to magi.config.json.");
  }

  if (!isOpenAICompatibleProvider(providerConfig.provider)) {
    throw new Error(`Unsupported model provider for Phase 1: ${providerConfig.provider}`);
  }

  const apiKey = providerConfig.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : undefined;

  if (providerConfig.apiKeyEnv && !apiKey) {
    throw new Error(`Missing ${providerConfig.apiKeyEnv} for model provider ${providerConfig.id}.`);
  }

  const baseURL = getProviderBaseUrl(providerConfig);
  const provider = createOpenAI({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(shouldUseChatCompletions(providerConfig.provider) ? { name: providerConfig.provider } : {}),
  });
  const model = shouldUseChatCompletions(providerConfig.provider)
    ? provider.chat(providerConfig.model)
    : provider(providerConfig.model);

  return {
    async generateText(input) {
      try {
        const result = await generateText({
          model,
          system: input.system ?? defaultSystemPrompt,
          prompt: input.prompt,
        });

        return { text: result.text };
      } catch (error) {
        throw new Error(
          `Model call failed for provider ${providerConfig.id} (${providerConfig.provider}, model ${providerConfig.model}${baseURL === undefined ? "" : `, baseUrl ${baseURL}`}): ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

function isOpenAICompatibleProvider(provider: ModelProviderSettings["provider"]): boolean {
  return provider === "openai" || provider === "deepseek" || provider === "custom";
}

function shouldUseChatCompletions(provider: ModelProviderSettings["provider"]): boolean {
  return provider === "deepseek" || provider === "custom";
}

function getProviderBaseUrl(providerConfig: ModelProviderSettings): string | undefined {
  if (providerConfig.baseUrl !== undefined) {
    return providerConfig.baseUrl;
  }

  if (providerConfig.provider === "deepseek") {
    return defaultDeepSeekBaseUrl;
  }

  return undefined;
}
