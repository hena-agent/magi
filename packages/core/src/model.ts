// biome-ignore lint/style/noExcessiveLinesPerFile: model adapter keeps provider-specific stream handling together.
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { generateText, type LanguageModel, streamText } from "ai";
import { listEffectiveModelProviders, type ModelProviderSettings } from "./model-catalog.js";
import {
  getProviderBaseUrl,
  resolveLanguageModel,
  resolveModelRuntimeCredentials,
} from "./model-runtime.js";
import { formatToolCalls, formatToolDefinitions } from "./model-tools.js";
import { createOpenAICodexOAuthFetch } from "./openai-codex-oauth.js";
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
  sessionId?: string;
  workspaceRoot?: string;
};

export type PrimaryModelAdapter = {
  provider?: SelectedModelProvider;
  generateText(input: { system?: string; prompt: string }): Promise<{ text: string }>;
  generateStep?(input: {
    system?: string;
    messages: ModelMessage[];
    tools: ModelToolDefinition[];
    toolChoice?: "auto" | "none";
    onStreamEvent?: (event: ModelStreamEvent) => void;
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
  content: string | ModelContentPart[];
  toolCallId?: string;
};

export type ModelProviderMetadata = {
  openai?: {
    itemId?: string;
    responseId?: string;
    serviceTier?: string | null;
    reasoningEncryptedContent?: string | null;
    [key: string]: unknown;
  };
  anthropic?: Record<string, unknown>;
  google?: Record<string, unknown>;
  bedrock?: Record<string, unknown>;
  [provider: string]: Record<string, unknown> | undefined;
};

export type ModelToolResultValue =
  | { type: "json"; value: unknown }
  | { type: "text"; value: unknown }
  | { type: "error"; value: unknown };

export type ModelTextPart = {
  type: "text";
  text: string;
  providerMetadata?: ModelProviderMetadata;
};

export type ModelReasoningPart = {
  type: "reasoning";
  text: string;
  providerMetadata?: ModelProviderMetadata;
};

export type ModelToolCallPart = {
  type: "tool-call";
  id: string;
  name: string;
  input: unknown;
  providerExecuted?: boolean;
  providerMetadata?: ModelProviderMetadata;
};

export type ModelToolResultPart = {
  type: "tool-result";
  id: string;
  name: string;
  result: ModelToolResultValue;
  providerExecuted?: boolean;
  providerMetadata?: ModelProviderMetadata;
};

export type ModelContentPart =
  | ModelTextPart
  | ModelReasoningPart
  | ModelToolCallPart
  | ModelToolResultPart;

export type ModelToolDefinition = {
  name: ToolName;
  description: string;
  inputSchema: unknown;
};

export type ModelStepResponse = {
  text: string;
  reasoningText?: string;
  content?: ModelContentPart[];
  toolCalls: ModelToolCall[];
  finishReason?: string;
  streamStats?: ModelStreamStats;
};

export type ModelStreamStats = {
  textDeltaCount: number;
  textCharCount: number;
  reasoningDeltaCount: number;
  reasoningCharCount: number;
  toolCallCount: number;
  toolNames: string[];
  streamPartTypes: string[];
};

export type ModelStreamEvent =
  | { type: "text_delta"; id?: string; text: string; providerMetadata?: ModelProviderMetadata }
  | { type: "reasoning_start"; id: string; providerMetadata?: ModelProviderMetadata }
  | { type: "reasoning_delta"; id: string; text: string; providerMetadata?: ModelProviderMetadata }
  | { type: "reasoning_end"; id: string; providerMetadata?: ModelProviderMetadata }
  | {
      type: "tool_input_start";
      id: string;
      toolName: string;
      providerMetadata?: ModelProviderMetadata;
    }
  | { type: "tool_input_delta"; id: string; delta: string }
  | { type: "tool_input_end"; id: string; providerMetadata?: ModelProviderMetadata }
  | {
      type: "tool_call";
      id: string;
      toolName: string;
      input: unknown;
      providerExecuted?: boolean;
      providerMetadata?: ModelProviderMetadata;
    }
  | { type: "finish_step"; finishReason?: string; providerMetadata?: ModelProviderMetadata };

export type ModelToolCall = {
  id: string;
  name: string;
  input: unknown;
  providerExecuted?: boolean;
  providerMetadata?: ModelProviderMetadata;
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
    ...(config.sessionId === undefined ? {} : { sessionId: config.sessionId }),
    ...(config.workspaceRoot === undefined ? {} : { workspaceRoot: config.workspaceRoot }),
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
          openai: {
            store: false,
            instructions: input.system ?? defaultSystemPrompt,
            reasoning: { summary: "auto" },
          },
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
  const response = await createOpenAICodexOAuthFetch({
    workspaceRoot: requireOAuthWorkspaceRoot(runtime),
    sessionId: runtime.sessionId,
  })("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: runtime.providerConfig.model,
      input: formatOpenAIResponsesInput(input.messages, false),
      store: false,
      instructions: input.system ?? defaultSystemPrompt,
      include: ["reasoning.encrypted_content"],
      reasoning: { summary: "auto" },
      tools: input.tools.map(formatResponsesToolDefinition),
      tool_choice: input.toolChoice ?? "auto",
      stream: true,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI Responses request failed ${response.status}: ${await response.text()}`);
  }

  return parseOpenAIResponsesStream(runtime, response, input.onStreamEvent);
}

type OpenAIResponsesToolState = {
  id: string;
  name: string;
  input: string;
  providerMetadata?: ModelProviderMetadata;
};

type OpenAIResponsesParseState = {
  textParts: string[];
  reasoningParts: string[];
  contentParts: ModelContentPart[];
  toolCalls: ModelToolCall[];
  streamStats: ModelStreamStats;
  finishReason?: string;
  reasoningIds: Set<string>;
  reasoningText: Map<string, string[]>;
  reasoningMetadata: Map<string, ModelProviderMetadata>;
  reasoningPartIndexes: Map<string, number>;
  tools: Map<string, OpenAIResponsesToolState>;
};

async function parseOpenAIResponsesStream(
  runtime: AdapterRuntime,
  response: Response,
  onStreamEvent: ((event: ModelStreamEvent) => void) | undefined,
): Promise<ModelStepResponse> {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const contentParts: ModelContentPart[] = [];
  const toolCalls: ModelToolCall[] = [];
  const state: OpenAIResponsesParseState = {
    textParts,
    reasoningParts,
    contentParts,
    toolCalls,
    streamStats: createEmptyStreamStats(),
    reasoningIds: new Set(),
    reasoningText: new Map(),
    reasoningMetadata: new Map(),
    reasoningPartIndexes: new Map(),
    tools: new Map(),
  };

  for await (const event of readOpenAIResponsesSse(response)) {
    await appendRawModelLog(runtime, "oauth-raw-event", event);
    handleOpenAIResponsesEvent(state, event, onStreamEvent);
  }

  const reasoningText = reasoningParts.join("") || undefined;
  await appendRawModelLog(runtime, "oauth-step-result", {
    text: textParts.join(""),
    reasoningText,
    content: contentParts,
    toolCalls,
    finishReason: state.finishReason,
    streamStats: state.streamStats,
  });

  return {
    text: textParts.join(""),
    ...(reasoningText === undefined ? {} : { reasoningText }),
    content: contentParts,
    toolCalls,
    finishReason: state.finishReason,
    streamStats: state.streamStats,
  };
}

function createEmptyStreamStats(): ModelStreamStats {
  return {
    textDeltaCount: 0,
    textCharCount: 0,
    reasoningDeltaCount: 0,
    reasoningCharCount: 0,
    toolCallCount: 0,
    toolNames: [],
    streamPartTypes: [],
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: OpenAI Responses SSE events are best handled in one switch table.
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Keeping the protocol event table together makes event handling auditable.
function handleOpenAIResponsesEvent(
  state: OpenAIResponsesParseState,
  event: Record<string, unknown>,
  onStreamEvent: ((event: ModelStreamEvent) => void) | undefined,
): void {
  const type = readOptionalString(event, "type") ?? "unknown";
  state.streamStats.streamPartTypes.push(type);

  switch (type) {
    case "response.output_text.delta": {
      const delta = readOptionalString(event, "delta");
      if (!delta) return;
      state.streamStats.textDeltaCount += 1;
      state.streamStats.textCharCount += delta.length;
      state.textParts.push(delta);
      appendTextPart(state, delta);
      onStreamEvent?.({ type: "text_delta", text: delta });
      return;
    }
    case "response.output_item.added": {
      const item = readRecord(event, "item");
      if (item?.type === "reasoning") {
        const itemId = String(item.id ?? readOptionalString(event, "item_id") ?? "reasoning-0");
        ensureReasoningStarted(
          state,
          itemId,
          0,
          onStreamEvent,
          openAIReasoningMetadata(itemId, readOptionalNullableString(item, "encrypted_content")),
        );
        return;
      }
      if (item?.type === "function_call") {
        const itemId = String(
          item.id ?? readOptionalString(event, "item_id") ?? crypto.randomUUID(),
        );
        const id = String(item.call_id ?? itemId);
        const name = String(item.name ?? "tool");
        const providerMetadata = openAIToolMetadata(itemId);
        state.tools.set(itemId, {
          id,
          name,
          input: String(item.arguments ?? ""),
          providerMetadata,
        });
        onStreamEvent?.({ type: "tool_input_start", id, toolName: name, providerMetadata });
      }
      return;
    }
    case "response.reasoning_summary_part.added": {
      const itemId = readOptionalString(event, "item_id") ?? "reasoning-0";
      const summaryIndex = readOptionalNumber(event, "summary_index") ?? 0;
      ensureReasoningStarted(
        state,
        itemId,
        summaryIndex,
        onStreamEvent,
        openAIReasoningMetadata(itemId, null),
      );
      return;
    }
    case "response.reasoning_text.delta":
    case "response.reasoning_summary.delta":
    case "response.reasoning_summary_text.delta": {
      const delta = readOptionalString(event, "delta");
      if (!delta) return;
      const itemId = readOptionalString(event, "item_id") ?? "reasoning-0";
      const summaryIndex = readOptionalNumber(event, "summary_index") ?? 0;
      const id = ensureReasoningStarted(state, itemId, summaryIndex, onStreamEvent);
      state.streamStats.reasoningDeltaCount += 1;
      state.streamStats.reasoningCharCount += delta.length;
      state.reasoningParts.push(delta);
      appendReasoningDelta(state, id, delta);
      onStreamEvent?.({
        type: "reasoning_delta",
        id,
        text: delta,
        providerMetadata: state.reasoningMetadata.get(id),
      });
      return;
    }
    case "response.reasoning_text.done":
    case "response.reasoning_summary.done":
    case "response.reasoning_summary_text.done":
    case "response.reasoning_summary_part.done": {
      const itemId = readOptionalString(event, "item_id") ?? "reasoning-0";
      const summaryIndex = readOptionalNumber(event, "summary_index") ?? 0;
      finishReasoning(state, reasoningId(itemId, summaryIndex), onStreamEvent);
      return;
    }
    case "response.function_call_arguments.delta": {
      const itemId = readOptionalString(event, "item_id");
      const delta = readOptionalString(event, "delta");
      if (!itemId || delta === undefined) return;
      const tool = ensureToolState(state, itemId, event, onStreamEvent);
      tool.input += delta;
      onStreamEvent?.({ type: "tool_input_delta", id: tool.id, delta });
      return;
    }
    case "response.output_item.done": {
      const item = readRecord(event, "item");
      if (item?.type === "function_call") {
        finishFunctionCall(state, item, event, onStreamEvent);
        return;
      }
      if (item?.type === "reasoning") {
        const itemId = String(item.id ?? readOptionalString(event, "item_id") ?? "reasoning-0");
        for (const id of [...state.reasoningIds].filter((candidate) =>
          candidate.startsWith(`${itemId}:`),
        )) {
          finishReasoning(state, id, onStreamEvent);
        }
      }
      return;
    }
    case "response.completed":
    case "response.incomplete": {
      state.finishReason = state.toolCalls.length > 0 ? "tool-calls" : "stop";
      onStreamEvent?.({ type: "finish_step", finishReason: state.finishReason });
      return;
    }
    case "response.failed":
    case "error":
      throw new Error(formatOpenAIResponseError(event));
  }
}

function ensureReasoningStarted(
  state: OpenAIResponsesParseState,
  itemId: string,
  summaryIndex: number,
  onStreamEvent: ((event: ModelStreamEvent) => void) | undefined,
  providerMetadata?: ModelProviderMetadata,
): string {
  const id = reasoningId(itemId, summaryIndex);
  if (providerMetadata) state.reasoningMetadata.set(id, providerMetadata);
  if (!state.reasoningIds.has(id)) {
    state.reasoningIds.add(id);
    state.reasoningPartIndexes.set(id, state.contentParts.length);
    state.contentParts.push({
      type: "reasoning",
      text: "",
      ...(providerMetadata ? { providerMetadata } : {}),
    });
    onStreamEvent?.({ type: "reasoning_start", id, providerMetadata });
  }

  return id;
}

function finishReasoning(
  state: OpenAIResponsesParseState,
  id: string,
  onStreamEvent: ((event: ModelStreamEvent) => void) | undefined,
): void {
  if (!state.reasoningIds.delete(id)) return;
  onStreamEvent?.({ type: "reasoning_end", id, providerMetadata: state.reasoningMetadata.get(id) });
}

function reasoningId(itemId: string, summaryIndex: number): string {
  return `${itemId}:${summaryIndex}`;
}

function appendTextPart(state: OpenAIResponsesParseState, text: string): void {
  const previous = state.contentParts.at(-1);
  if (previous?.type === "text") {
    previous.text += text;
    return;
  }

  state.contentParts.push({ type: "text", text });
}

function appendReasoningDelta(state: OpenAIResponsesParseState, id: string, text: string): void {
  const index = state.reasoningPartIndexes.get(id);
  if (index === undefined) {
    const providerMetadata = state.reasoningMetadata.get(id);
    state.reasoningPartIndexes.set(id, state.contentParts.length);
    state.contentParts.push({
      type: "reasoning",
      text,
      ...(providerMetadata ? { providerMetadata } : {}),
    });
    return;
  }

  const part = state.contentParts[index];
  if (part?.type === "reasoning") part.text += text;
}

function openAIReasoningMetadata(
  itemId: string,
  reasoningEncryptedContent: string | null | undefined,
): ModelProviderMetadata {
  return { openai: { itemId, reasoningEncryptedContent } };
}

function openAIToolMetadata(itemId: string): ModelProviderMetadata {
  return { openai: { itemId } };
}

function ensureToolState(
  state: OpenAIResponsesParseState,
  itemId: string,
  event: Record<string, unknown>,
  onStreamEvent: ((event: ModelStreamEvent) => void) | undefined,
): OpenAIResponsesToolState {
  const existing = state.tools.get(itemId);
  if (existing) return existing;

  const id = readOptionalString(event, "call_id") ?? itemId;
  const created = { id, name: "tool", input: "", providerMetadata: openAIToolMetadata(itemId) };
  state.tools.set(itemId, created);
  onStreamEvent?.({
    type: "tool_input_start",
    id,
    toolName: created.name,
    providerMetadata: created.providerMetadata,
  });

  return created;
}

function finishFunctionCall(
  state: OpenAIResponsesParseState,
  item: Record<string, unknown>,
  event: Record<string, unknown>,
  onStreamEvent: ((event: ModelStreamEvent) => void) | undefined,
): void {
  const itemId = String(item.id ?? readOptionalString(event, "item_id") ?? crypto.randomUUID());
  const existing = state.tools.get(itemId);
  const id = String(item.call_id ?? existing?.id ?? itemId);
  const name = String(item.name ?? existing?.name ?? "tool");
  const rawInput = String(item.arguments ?? existing?.input ?? "");
  const providerMetadata = existing?.providerMetadata ?? openAIToolMetadata(itemId);

  if (!existing) {
    onStreamEvent?.({ type: "tool_input_start", id, toolName: name, providerMetadata });
    if (rawInput.length > 0) onStreamEvent?.({ type: "tool_input_delta", id, delta: rawInput });
  } else if (existing.input.length === 0 && rawInput.length > 0) {
    onStreamEvent?.({ type: "tool_input_delta", id, delta: rawInput });
  }

  onStreamEvent?.({ type: "tool_input_end", id, providerMetadata });
  const toolCall = { id, name, input: parseJsonInput(rawInput), providerMetadata };
  state.toolCalls.push(toolCall);
  state.contentParts.push({
    type: "tool-call",
    id,
    name,
    input: toolCall.input,
    providerMetadata,
  });
  state.streamStats.toolCallCount += 1;
  state.streamStats.toolNames.push(name);
  onStreamEvent?.({
    type: "tool_call",
    id,
    toolName: name,
    input: toolCall.input,
    providerMetadata,
  });
}

async function* readOpenAIResponsesSse(
  response: Response,
): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) return;

  const decoder = new TextDecoder();
  let buffer = "";

  for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const parsed = parseSseEvent(event);
      if (parsed) yield parsed;
    }
  }

  buffer += decoder.decode();
  const parsed = parseSseEvent(buffer);
  if (parsed) yield parsed;
}

function parseSseEvent(event: string): Record<string, unknown> | undefined {
  const data = event
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n")
    .trim();
  if (!data || data === "[DONE]") return undefined;

  const parsed = JSON.parse(data) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : undefined;
}

function formatOpenAIResponsesInput(
  messages: ModelMessage[],
  store: boolean | undefined,
): Record<string, unknown>[] {
  const input: Record<string, unknown>[] = [];

  for (const message of messages) {
    const parts = modelContentParts(message.content);
    if (message.role === "system") {
      input.push({ role: "system", content: partsToPlainText(parts) });
      continue;
    }

    if (message.role === "user") {
      input.push({
        role: "user",
        content: textLikeParts(parts).map((part) => ({ type: "input_text", text: part.text })),
      });
      continue;
    }

    if (message.role === "assistant") {
      appendOpenAIAssistantParts(input, parts, store);
      continue;
    }

    appendOpenAIToolResultParts(input, parts, message.toolCallId);
  }

  return input;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: OpenAI Responses lowering is clearer as a protocol part switch.
function appendOpenAIAssistantParts(
  input: Record<string, unknown>[],
  parts: ModelContentPart[],
  store: boolean | undefined,
): void {
  const textParts: ModelTextPart[] = [];
  const flushText = () => {
    if (textParts.length === 0) return;
    input.push({
      role: "assistant",
      content: textParts.map((part) => ({ type: "output_text", text: part.text })),
    });
    textParts.splice(0, textParts.length);
  };

  for (const part of parts) {
    if (part.type === "text") {
      textParts.push(part);
      continue;
    }
    flushText();

    if (part.type === "reasoning") {
      const lowered = lowerOpenAIReasoningPart(part, store);
      if (lowered) input.push(lowered);
      continue;
    }
    if (part.type === "tool-call" && part.providerExecuted !== true) {
      input.push({
        type: "function_call",
        call_id: part.id,
        name: part.name,
        arguments: encodeJson(part.input),
      });
      continue;
    }
    if (part.type === "tool-result" && part.providerExecuted === true) {
      const itemId = part.providerMetadata?.openai?.itemId;
      if (store !== false && itemId) input.push({ type: "item_reference", id: itemId });
    }
  }

  flushText();
}

function appendOpenAIToolResultParts(
  input: Record<string, unknown>[],
  parts: ModelContentPart[],
  fallbackToolCallId: string | undefined,
): void {
  for (const part of parts) {
    if (part.type !== "tool-result") continue;
    input.push({
      type: "function_call_output",
      call_id: part.id || fallbackToolCallId || "",
      output: openAIToolResultOutput(part.result),
    });
  }
}

function lowerOpenAIReasoningPart(
  part: ModelReasoningPart,
  store: boolean | undefined,
): Record<string, unknown> | undefined {
  const itemId = part.providerMetadata?.openai?.itemId;
  if (!itemId) return undefined;

  if (store !== false) return { type: "item_reference", id: itemId };

  const encryptedContent = part.providerMetadata?.openai?.reasoningEncryptedContent;
  if (typeof encryptedContent !== "string") return undefined;

  return {
    type: "reasoning",
    id: itemId,
    summary: part.text.length > 0 ? [{ type: "summary_text", text: part.text }] : [],
    encrypted_content: encryptedContent,
  };
}

function openAIToolResultOutput(result: ModelToolResultValue): string {
  if (typeof result.value === "string") return result.value;
  return encodeJson(result.value);
}

function modelContentParts(content: ModelMessage["content"]): ModelContentPart[] {
  return typeof content === "string" ? [{ type: "text", text: content }] : content;
}

function textLikeParts(parts: ModelContentPart[]): ModelTextPart[] {
  return parts.flatMap((part) => {
    if (part.type === "text") return [part];
    if (part.type === "reasoning") return [];
    return [{ type: "text", text: encodeJson(part) }];
  });
}

function partsToPlainText(parts: ModelContentPart[]): string {
  return textLikeParts(parts)
    .map((part) => part.text)
    .join("\n");
}

function encodeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatResponsesToolDefinition(tool: ModelToolDefinition): Record<string, unknown> {
  return {
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  };
}

function parseJsonInput(value: string): unknown {
  if (!value) return {};

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function readRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> | undefined {
  const value = source[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readOptionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

function readOptionalNullableString(
  source: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const value = source[key];
  return typeof value === "string" || value === null ? value : undefined;
}

function readOptionalNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" ? value : undefined;
}

function formatOpenAIResponseError(event: Record<string, unknown>): string {
  const error =
    readRecord(event, "error") ?? readRecord(readRecord(event, "response") ?? {}, "error");
  const message = error ? readOptionalString(error, "message") : undefined;
  const code = error ? readOptionalString(error, "code") : undefined;
  return (
    [code, message].filter((part): part is string => part !== undefined).join(": ") ||
    "OpenAI Responses request failed"
  );
}

function requireOAuthWorkspaceRoot(runtime: AdapterRuntime): string {
  if (!runtime.workspaceRoot)
    throw new Error("OpenAI OAuth model providers require workspaceRoot.");
  return runtime.workspaceRoot;
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
  await appendRawModelLog(runtime, "chat-step-result", {
    text: result.text,
    reasoningText: result.reasoningText,
    toolCalls: formatToolCalls(result.toolCalls),
    finishReason: result.finishReason,
  });

  return {
    text: result.text,
    ...(result.reasoningText === undefined ? {} : { reasoningText: result.reasoningText }),
    content: [
      ...(result.reasoningText === undefined
        ? []
        : [{ type: "reasoning" as const, text: result.reasoningText }]),
      ...(result.text.length === 0 ? [] : [{ type: "text" as const, text: result.text }]),
      ...formatToolCalls(result.toolCalls).map(
        (toolCall): ModelToolCallPart => ({
          type: "tool-call",
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        }),
      ),
    ],
    toolCalls: formatToolCalls(result.toolCalls),
    finishReason: result.finishReason,
  };
}

async function appendRawModelLog(
  runtime: AdapterRuntime,
  phase: string,
  payload: unknown,
): Promise<void> {
  const directory = join(runtime.workspaceRoot ?? process.cwd(), ".magi", "debug");
  await mkdir(directory, { recursive: true });
  await appendFile(
    join(directory, "model-raw.ndjson"),
    `${JSON.stringify({
      createdAt: new Date().toISOString(),
      providerId: runtime.providerConfig.id,
      provider: runtime.providerConfig.provider,
      model: runtime.providerConfig.model,
      phase,
      payload,
    })}\n`,
  );
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
        `${message.role}${message.toolCallId ? `(${message.toolCallId})` : ""}: ${formatModelMessageContent(message.content)}`,
    )
    .join("\n\n");
}

function formatModelMessageContent(content: ModelMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part.type === "text" || part.type === "reasoning") return part.text;
      return encodeJson(part);
    })
    .join("\n");
}

function memoizeAsync<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | undefined;

  return () => {
    cached ??= factory();
    return cached;
  };
}
