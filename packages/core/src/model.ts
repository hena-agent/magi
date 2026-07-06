import { generateText, streamText, type LanguageModel } from "ai";
import { listEffectiveModelProviders, type ModelProviderSettings } from "./model-catalog.js";
import {
  getProviderBaseUrl,
  resolveLanguageModel,
  resolveModelRuntimeCredentials,
} from "./model-runtime.js";
import { formatToolCalls, formatToolDefinitions } from "./model-tools.js";
import type { ToolName } from "./tools.js";

type ModelAdapterConfig = {
  workspaceRoot?: string;
  selectedProviderId?: string;
  sessionId?: string;
  modelProviders: ModelProviderSettings[];
};

type AdapterRuntime = {
  providerConfig: ModelProviderSettings;
  getModel: () => Promise<LanguageModel>;
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
  toolCalls: ModelToolCall[];
  finishReason?: string;
};

export type ModelToolCall = {
  id: string;
  name: string;
  input: unknown;
};

const defaultSystemPrompt =
  "You are MAGI, a local coding assistant. Respond concisely. Do not claim tool results unless they are provided in the prompt.";

export function createPrimaryModelAdapter(config: ModelAdapterConfig): PrimaryModelAdapter {
  const providerConfig = selectProviderConfig(config);
  const credentials = resolveModelRuntimeCredentials(providerConfig);

  if (!credentials.isOAuth && credentials.apiKeyEnv && !credentials.apiKey) {
    throw new Error(`Missing ${credentials.apiKeyEnv} for model provider ${providerConfig.id}.`);
  }

  if (credentials.isOAuth && !config.workspaceRoot) {
    throw new Error("OpenAI OAuth model providers require workspaceRoot in the adapter config.");
  }

  const baseURL = getProviderBaseUrl(providerConfig);
  const runtime: AdapterRuntime = {
    providerConfig,
    getModel: memoizeAsync(() =>
      resolveLanguageModel({
        providerConfig,
        apiKey: credentials.apiKey,
        workspaceRoot: config.workspaceRoot,
        sessionId: config.sessionId,
      }),
    ),
    ...(baseURL === undefined ? {} : { baseURL }),
    isOAuth: credentials.isOAuth,
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
        model: await runtime.getModel(),
        providerOptions: {
          openai: { store: false, instructions: input.system ?? defaultSystemPrompt },
        },
        prompt: input.prompt,
      });

      return { text: await result.text };
    }

    const result = await generateText({
      model: await runtime.getModel(),
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
    model: await runtime.getModel(),
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
    model: await runtime.getModel(),
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

function formatModelMessages(messages: ModelMessage[]): string {
  return messages
    .map(
      (message) =>
        `${message.role}${message.toolCallId ? `(${message.toolCallId})` : ""}: ${message.content}`,
    )
    .join("\n\n");
}

function memoizeAsync<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;

  return () => {
    cached ??= factory();
    return cached;
  };
}
