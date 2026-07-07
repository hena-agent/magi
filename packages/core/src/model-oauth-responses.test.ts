import { afterEach, expect, it, vi } from "vitest";
import { createPrimaryModelAdapter } from "./model.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.MAGI_AUTH_CONTENT;
  vi.restoreAllMocks();
});

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: This regression asserts the full lifecycle event contract.
it("parses OpenAI OAuth responses reasoning summary and tool call deltas", async () => {
  const fetchMock = installSseFetch(summaryToolEvents());
  const streamEvents: unknown[] = [];

  const response = await createOpenAIAdapter().generateStep?.({
    messages: [{ role: "user", content: "List TypeScript files." }],
    tools: [{ name: "glob", description: "Search files", inputSchema: { type: "object" } }],
    onStreamEvent: (event) => streamEvents.push(event),
  });

  const body = firstRequestBody(fetchMock);
  expect(body.store).toBe(false);
  expect(body.include).toEqual(["reasoning.encrypted_content"]);
  expect(body.reasoning).toEqual({ summary: "auto" });
  expect(body.tools?.[0]).toMatchObject({ type: "function", name: "glob" });
  expect(body.tools?.[0]?.parameters).toEqual({ type: "object" });
  expect(response).toMatchObject({
    text: "Done",
    reasoningText: "Thinking.",
    finishReason: "tool-calls",
    toolCalls: [
      {
        id: "call_1",
        name: "glob",
        input: { pattern: "**/*.ts" },
        providerMetadata: { openai: { itemId: "fc_1" } },
      },
    ],
    content: [
      {
        type: "reasoning",
        text: "Thinking.",
        providerMetadata: {
          openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" },
        },
      },
      { type: "text", text: "Done" },
      {
        type: "tool-call",
        id: "call_1",
        name: "glob",
        input: { pattern: "**/*.ts" },
        providerMetadata: { openai: { itemId: "fc_1" } },
      },
    ],
  });
  expect(response?.streamStats).toMatchObject({
    textDeltaCount: 1,
    reasoningDeltaCount: 1,
    toolCallCount: 1,
    toolNames: ["glob"],
  });
  expect(streamEvents).toEqual([
    {
      type: "reasoning_start",
      id: "rs_1:0",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } },
    },
    {
      type: "reasoning_delta",
      id: "rs_1:0",
      text: "Thinking.",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } },
    },
    {
      type: "reasoning_end",
      id: "rs_1:0",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } },
    },
    { type: "text_delta", text: "Done" },
    {
      type: "tool_input_start",
      id: "call_1",
      toolName: "glob",
      providerMetadata: { openai: { itemId: "fc_1" } },
    },
    { type: "tool_input_delta", id: "call_1", delta: '{"pattern":"**/*.ts"}' },
    { type: "tool_input_end", id: "call_1", providerMetadata: { openai: { itemId: "fc_1" } } },
    {
      type: "tool_call",
      id: "call_1",
      toolName: "glob",
      input: { pattern: "**/*.ts" },
      providerMetadata: { openai: { itemId: "fc_1" } },
    },
    { type: "finish_step", finishReason: "tool-calls" },
  ]);
});

it("keeps encrypted-only OpenAI OAuth reasoning as lifecycle events without text", async () => {
  installSseFetch(encryptedOnlyEvents());
  const streamEvents: unknown[] = [];

  const response = await createOpenAIAdapter().generateStep?.({
    messages: [{ role: "user", content: "Hi" }],
    tools: [],
    onStreamEvent: (event) => streamEvents.push(event),
  });

  expect(response?.text).toBe("ok");
  expect(response?.reasoningText).toBeUndefined();
  expect(response?.content).toEqual([
    {
      type: "reasoning",
      text: "",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } },
    },
    { type: "text", text: "ok" },
  ]);
  expect(response?.streamStats?.reasoningDeltaCount).toBe(0);
  expect(streamEvents).toEqual([
    {
      type: "reasoning_start",
      id: "rs_1:0",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } },
    },
    {
      type: "reasoning_end",
      id: "rs_1:0",
      providerMetadata: { openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted" } },
    },
    { type: "text_delta", text: "ok" },
    { type: "finish_step", finishReason: "stop" },
  ]);
});

it("lowers typed OpenAI Responses history instead of flattening it into one prompt", async () => {
  const fetchMock = installSseFetch([{ type: "response.completed", response: { id: "resp_1" } }]);

  await createOpenAIAdapter().generateStep?.({
    messages: [
      { role: "user", content: "What changed?" },
      {
        role: "assistant",
        content: [
          {
            type: "reasoning",
            text: "Checked the previous diff.",
            providerMetadata: {
              openai: { itemId: "rs_1", reasoningEncryptedContent: "encrypted-state" },
            },
          },
          { type: "text", text: "The parser changed." },
          { type: "tool-call", id: "call_1", name: "read", input: { path: "src/model.ts" } },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_1",
        content: [
          {
            type: "tool-result",
            id: "call_1",
            name: "read",
            result: { type: "text", value: "file contents" },
          },
        ],
      },
      { role: "user", content: "Summarize it." },
    ],
    tools: [],
  });

  expect(firstRequestBody(fetchMock).input).toEqual([
    { role: "user", content: [{ type: "input_text", text: "What changed?" }] },
    {
      type: "reasoning",
      id: "rs_1",
      summary: [{ type: "summary_text", text: "Checked the previous diff." }],
      encrypted_content: "encrypted-state",
    },
    { role: "assistant", content: [{ type: "output_text", text: "The parser changed." }] },
    {
      type: "function_call",
      call_id: "call_1",
      name: "read",
      arguments: '{"path":"src/model.ts"}',
    },
    { type: "function_call_output", call_id: "call_1", output: "file contents" },
    { role: "user", content: [{ type: "input_text", text: "Summarize it." }] },
  ]);
});

function createOpenAIAdapter() {
  process.env.MAGI_AUTH_CONTENT = JSON.stringify({
    openai: {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    },
  });

  return createPrimaryModelAdapter({
    workspaceRoot: process.cwd(),
    selectedProviderId: "openai",
    modelProviders: [],
  });
}

function installSseFetch(events: Record<string, unknown>[]) {
  const fetchMock = vi.fn(
    async () =>
      new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  globalThis.fetch = fetchMock;
  return fetchMock;
}

function firstRequestBody(fetchMock: ReturnType<typeof installSseFetch>): {
  include?: unknown;
  reasoning?: unknown;
  store?: unknown;
  input?: unknown;
  tools?: Array<{ type?: unknown; name?: unknown; parameters?: unknown }>;
} {
  const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
  return JSON.parse(String(init.body)) as ReturnType<typeof firstRequestBody>;
}

function summaryToolEvents(): Record<string, unknown>[] {
  return [
    {
      type: "response.output_item.added",
      item: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted" },
    },
    {
      type: "response.reasoning_summary_text.delta",
      item_id: "rs_1",
      summary_index: 0,
      delta: "Thinking.",
    },
    { type: "response.reasoning_summary_text.done", item_id: "rs_1", summary_index: 0 },
    { type: "response.output_text.delta", delta: "Done" },
    {
      type: "response.output_item.added",
      item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "glob", arguments: "" },
    },
    {
      type: "response.function_call_arguments.delta",
      item_id: "fc_1",
      delta: '{"pattern":"**/*.ts"}',
    },
    {
      type: "response.output_item.done",
      item: {
        id: "fc_1",
        type: "function_call",
        call_id: "call_1",
        name: "glob",
        arguments: '{"pattern":"**/*.ts"}',
      },
    },
    { type: "response.completed", response: { id: "resp_1" } },
  ];
}

function encryptedOnlyEvents(): Record<string, unknown>[] {
  return [
    {
      type: "response.output_item.added",
      item: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted" },
    },
    {
      type: "response.output_item.done",
      item: { id: "rs_1", type: "reasoning", encrypted_content: "encrypted" },
    },
    { type: "response.output_text.delta", delta: "ok" },
    { type: "response.completed", response: { id: "resp_1" } },
  ];
}
