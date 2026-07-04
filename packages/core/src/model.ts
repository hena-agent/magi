import { createOpenAI } from "@ai-sdk/openai";
import { generateText, streamText } from "ai";
import { OAUTH_DUMMY_KEY } from "./auth.js";
import { listEffectiveModelProviders, type ModelProviderSettings } from "./model-catalog.js";
import { formatToolCalls, formatToolDefinitions } from "./model-tools.js";
import { createOpenAICodexOAuthFetch, isOpenAICodexOAuthModel } from "./openai-codex-oauth.js";
import type { ToolCall, ToolName } from "./tools.js";

type ModelAdapterConfig = {
  workspaceRoot?: string;
  selectedProviderId?: string;
  sessionId?: string;
  modelProviders: ModelProviderSettings[];
};

type AdapterRuntime = {
  providerConfig: ModelProviderSettings;
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  baseURL?: string;
  isOAuth: boolean;
};

export type PrimaryModelAdapter = {
  provider?: SelectedModelProvider;
  generateText(input: { system?: string; prompt: string }): Promise<{ text: string }>;
  generateStep?(input: {
    system?: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
    toolChoice?: "auto" | "none";
  }): Promise<ModelStepResponse>;
};

export type SelectedModelProvider = {
  id: string;
  provider: ModelProviderSettings["provider"];
  model: string;
  auth?: ModelProviderSettings["auth"];
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
  const providerConfig = selectProviderConfig(config);

  if (!isOpenAICompatibleProvider(providerConfig.provider)) {
    throw new Error(`Unsupported model provider for Phase 1: ${providerConfig.provider}`);
  }

  const isOAuth = providerConfig.provider === "openai" && providerConfig.auth?.type === "oauth";
  const apiKey = isOAuth
    ? OAUTH_DUMMY_KEY
    : providerConfig.apiKeyEnv
      ? process.env[providerConfig.apiKeyEnv]
      : undefined;

  if (!isOAuth && providerConfig.apiKeyEnv && !apiKey) {
    throw new Error(`Missing ${providerConfig.apiKeyEnv} for model provider ${providerConfig.id}.`);
  }

  if (isOAuth && !config.workspaceRoot) {
    throw new Error("OpenAI OAuth model providers require workspaceRoot in the adapter config.");
  }

  const baseURL = getProviderBaseUrl(providerConfig);
  const provider = createOpenAI({
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(isOAuth && config.workspaceRoot
      ? {
          fetch: createOpenAICodexOAuthFetch({
            workspaceRoot: config.workspaceRoot,
            sessionId: config.sessionId,
          }),
        }
      : {}),
    ...(shouldUseChatCompletions(providerConfig.provider) ? { name: providerConfig.provider } : {}),
  });
  const runtime: AdapterRuntime = {
    providerConfig,
    model: selectLanguageModel(provider, providerConfig),
    ...(baseURL === undefined ? {} : { baseURL }),
    isOAuth,
  };

  return {
    provider: selectedProviderFromConfig(providerConfig),
    async generateText(input) {
      return generateAdapterText(runtime, input);
    },
    async generateStep(input) {
      return generateAdapterStep(runtime, input);
    },
  };
}

function selectedProviderFromConfig(providerConfig: ModelProviderSettings): SelectedModelProvider {
  return {
    id: providerConfig.id,
    provider: providerConfig.provider,
    model: providerConfig.model,
    ...(providerConfig.auth === undefined ? {} : { auth: providerConfig.auth }),
  };
}

async function generateAdapterText(
  runtime: AdapterRuntime,
  input: { system?: string; prompt: string },
): Promise<{ text: string }> {
  try {
    if (runtime.isOAuth) {
      const result = streamText({
        model: runtime.model,
        providerOptions: {
          openai: { store: false, instructions: input.system ?? defaultSystemPrompt },
        },
        prompt: input.prompt,
      });

      return { text: await result.text };
    }

    const result = await generateText({
      model: runtime.model,
      system: input.system ?? defaultSystemPrompt,
      prompt: input.prompt,
    });

    return { text: result.text };
  } catch (error) {
    throwModelCallError(runtime, error);
  }
}

async function generateAdapterStep(
  runtime: AdapterRuntime,
  input: Parameters<NonNullable<PrimaryModelAdapter["generateStep"]>>[0],
): Promise<ModelStepResponse> {
  try {
    return runtime.isOAuth
      ? await generateOAuthStep(runtime, input)
      : await generateChatStep(runtime, input);
  } catch (error) {
    throw new Error(
      `Native tool-call model step failed for provider ${runtime.providerConfig.id}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function generateOAuthStep(
  runtime: AdapterRuntime,
  input: Parameters<NonNullable<PrimaryModelAdapter["generateStep"]>>[0],
): Promise<ModelStepResponse> {
  const result = streamText({
    model: runtime.model,
    providerOptions: {
      openai: { store: false, instructions: input.system ?? defaultSystemPrompt },
    },
    prompt: formatModelMessages(input.messages),
    tools: formatToolDefinitions(input.tools),
    toolChoice: input.toolChoice ?? "auto",
  });
  const toolCalls = await result.toolCalls;
  const finalStep = await result.finalStep;

  return {
    text: await result.text,
    toolCalls: formatToolCalls(toolCalls),
    finishReason: finalStep.finishReason,
  };
}

async function generateChatStep(
  runtime: AdapterRuntime,
  input: Parameters<NonNullable<PrimaryModelAdapter["generateStep"]>>[0],
): Promise<ModelStepResponse> {
  const result = await generateText({
    model: runtime.model,
    system: input.system ?? defaultSystemPrompt,
    prompt: formatModelMessages(input.messages),
    tools: formatToolDefinitions(input.tools),
    toolChoice: input.toolChoice ?? "auto",
  });

  return {
    text: result.text,
    toolCalls: formatToolCalls(result.toolCalls),
    finishReason: result.finishReason,
  };
}

function throwModelCallError(runtime: AdapterRuntime, error: unknown): never {
  const { providerConfig, baseURL } = runtime;
  throw new Error(
    `Model call failed for provider ${providerConfig.id} (${providerConfig.provider}, model ${providerConfig.model}${baseURL === undefined ? "" : `, baseUrl ${baseURL}`}): ${error instanceof Error ? error.message : String(error)}`,
  );
}

function selectProviderConfig(config: ModelAdapterConfig): ModelProviderSettings {
  const providers = listEffectiveModelProviders({
    configProviders: config.modelProviders,
    workspaceRoot: config.workspaceRoot,
  });

  if (providers.length === 0) {
    throw new Error("No model provider configured. Add modelProviders to magi.config.json.");
  }

  if (!config.selectedProviderId) {
    return (config.modelProviders[0] ?? providers[0]) as ModelProviderSettings;
  }

  const providerConfig = providers.find((candidate) => candidate.id === config.selectedProviderId);

  if (!providerConfig) {
    throw new Error(`Model provider not configured: ${config.selectedProviderId}`);
  }

  return providerConfig;
}

function selectLanguageModel(
  provider: ReturnType<typeof createOpenAI>,
  providerConfig: ModelProviderSettings,
) {
  if (providerConfig.provider === "openai" && isOpenAICodexOAuthModel(providerConfig.model)) {
    return provider.responses(providerConfig.model);
  }

  if (shouldUseChatCompletions(providerConfig.provider)) {
    return provider.chat(providerConfig.model);
  }

  return provider(providerConfig.model);
}

function formatModelMessages(messages: ModelMessage[]): string {
  return messages
    .map(
      (message) =>
        `${message.role}${message.toolCallId ? `(${message.toolCallId})` : ""}: ${message.content}`,
    )
    .join("\n\n");
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
