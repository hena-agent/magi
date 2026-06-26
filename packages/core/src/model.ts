import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

type ModelProviderSettings = {
  id: string;
  provider: "openai" | "anthropic" | "google" | "custom";
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

export function createPrimaryModelAdapter(config: ModelAdapterConfig): PrimaryModelAdapter {
  const providerConfig = config.modelProviders[0];

  if (!providerConfig) {
    throw new Error("No model provider configured. Add modelProviders to magi.config.json.");
  }

  if (providerConfig.provider !== "openai") {
    throw new Error(`Unsupported model provider for Phase 1: ${providerConfig.provider}`);
  }

  const apiKey = providerConfig.apiKeyEnv ? process.env[providerConfig.apiKeyEnv] : undefined;

  if (providerConfig.apiKeyEnv && !apiKey) {
    throw new Error(`Missing ${providerConfig.apiKeyEnv} for model provider ${providerConfig.id}.`);
  }

  const provider = createOpenAI({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(providerConfig.baseUrl === undefined ? {} : { baseURL: providerConfig.baseUrl }),
  });
  const model = provider(providerConfig.model);

  return {
    async generateText(input) {
      const result = await generateText({
        model,
        system: input.system ?? defaultSystemPrompt,
        prompt: input.prompt,
      });

      return { text: result.text };
    },
  };
}
