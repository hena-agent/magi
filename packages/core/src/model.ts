import { createOpenAI } from "@ai-sdk/openai";
import { generateText, jsonSchema } from "ai";
import type { ToolCall, ToolName } from "./tools.js";

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
  generateStep?(input: {
    system?: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
    toolChoice?: "auto" | "none";
  }): Promise<ModelStepResponse>;
};

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};

export type ModelToolDefinition = {
  name: ToolName;
  description: string;
  inputSchema: unknown;
};

export type ModelStepResponse = {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
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
    async generateStep(input) {
      try {
        const result = await generateText({
          model,
          system: input.system ?? defaultSystemPrompt,
          prompt: formatModelMessages(input.messages),
          tools: Object.fromEntries(
            input.tools.map((toolDefinition) => [
              toolDefinition.name,
              {
                description: toolDefinition.description,
                inputSchema: jsonSchema(toolDefinition.inputSchema),
              },
            ]),
          ),
          toolChoice: input.toolChoice ?? "auto",
        });

        return {
          text: result.text,
          toolCalls: result.toolCalls.flatMap((toolCall) => {
            const name = String(toolCall.toolName);

            return isToolName(name)
              ? [{ id: toolCall.toolCallId, name, input: toolCall.input }]
              : [];
          }),
          finishReason: result.finishReason,
        };
      } catch (error) {
        throw new Error(
          `Native tool-call model step failed for provider ${providerConfig.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}

function formatModelMessages(messages: ModelMessage[]): string {
  return messages
    .map(
      (message) =>
        `${message.role}${message.toolCallId ? `(${message.toolCallId})` : ""}: ${message.content}`,
    )
    .join("\n\n");
}

function isToolName(value: string): value is ToolName {
  return (
    value === "read" ||
    value === "glob" ||
    value === "grep" ||
    value === "apply_patch" ||
    value === "bash"
  );
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
