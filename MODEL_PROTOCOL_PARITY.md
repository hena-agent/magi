# MODEL_PROTOCOL_PARITY.md

## Purpose

This document captures the root architecture gap discovered while comparing MAGI with OpenCode.

The visible bug started with OpenAI OAuth `gpt-5.5`: MAGI showed tool calls and encrypted reasoning lifecycle, but did not reliably show plaintext reasoning or final assistant text. A first-pass fix tried to parse OpenAI Responses SSE events directly. That was useful for diagnosis, but it was not the real fix.

The root issue is provider-agnostic:

- MAGI currently treats model context mostly as strings plus tool observations.
- OpenCode treats model context as typed content parts with provider metadata.
- Provider protocols are not interchangeable prompt strings. They have native histories: assistant text blocks, reasoning blocks, tool-call blocks, tool-result blocks, hosted-tool blocks, media blocks, cache hints, and provider-owned continuation metadata.

OpenAI Responses exposes this most clearly because encrypted reasoning state must be round-tripped through `reasoning` items or `item_reference` entries. Anthropic, Gemini, Bedrock, OpenAI Chat, OpenAI-compatible providers, and hosted tools have the same category of problem: each protocol needs a typed lowering layer and a typed streaming lifecycle, not ad-hoc prompt concatenation.

## Executive Summary

MAGI should stop treating provider-native tool calling as a thin alternative to JSON action prompting.

The target architecture is:

```txt
Session history
  -> canonical typed model messages
  -> provider protocol lowering
  -> provider transport stream
  -> canonical model stream events
  -> session message parts + tool execution
  -> continuation using typed history
```

This is the same high-level boundary used by OpenCode:

```txt
SessionMessage
  -> toLLMMessages(...)
  -> LLMRequest
  -> Protocol.body.from(request)
  -> Route transport/framing
  -> Protocol.stream.step(...)
  -> LLMEvent
  -> publish-llm-event
  -> SessionMessage
```

MAGI currently does this instead:

```txt
User request + observations
  -> formatNativeToolPrompt(...)
  -> one user text message
  -> provider call
  -> partial stream events
  -> tool calls converted to actions
  -> tool observations appended as text
  -> next iteration repeats with a new text prompt
```

That design loses provider-owned structure between turns.

## What OpenCode Does Differently

The following OpenCode files were inspected closely:

- `/Users/alma/Development/opencode/packages/llm/src/schema/messages.ts`
- `/Users/alma/Development/opencode/packages/llm/src/schema/events.ts`
- `/Users/alma/Development/opencode/packages/llm/src/route/protocol.ts`
- `/Users/alma/Development/opencode/packages/llm/src/route/client.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/openai-responses.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/openai-chat.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/anthropic-messages.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/gemini.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/bedrock-converse.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/utils/lifecycle.ts`
- `/Users/alma/Development/opencode/packages/llm/src/protocols/utils/tool-stream.ts`
- `/Users/alma/Development/opencode/packages/core/src/session/runner/llm.ts`
- `/Users/alma/Development/opencode/packages/core/src/session/runner/to-llm-message.ts`
- `/Users/alma/Development/opencode/packages/core/src/session/runner/publish-llm-event.ts`
- `/Users/alma/Development/opencode/packages/opencode/src/session/llm/native-request.ts`
- `/Users/alma/Development/opencode/packages/opencode/src/session/llm/native-runtime.ts`
- `/Users/alma/Development/opencode/packages/opencode/test/session/llm-native.test.ts`

### 1. OpenCode Has Canonical Typed Messages

OpenCode's canonical message model supports content parts such as:

- `text`
- `media`
- `reasoning`
- `tool-call`
- `tool-result`

Each part can carry provider metadata.

Relevant OpenCode shape from `packages/llm/src/schema/messages.ts`:

```ts
type ContentPart = TextPart | MediaPart | ToolCallPart | ToolResultPart | ReasoningPart
```

This is not just a UI abstraction. It is the source of truth for building provider requests.

### 2. OpenCode Has Canonical Stream Events

OpenCode streams provider output into a common event vocabulary:

- `step-start`
- `text-start`
- `text-delta`
- `text-end`
- `reasoning-start`
- `reasoning-delta`
- `reasoning-end`
- `tool-input-start`
- `tool-input-delta`
- `tool-input-end`
- `tool-call`
- `tool-result`
- `tool-error`
- `step-finish`
- `finish`
- `provider-error`

This matters because provider streams often emit partial content. A robust system must know when blocks start and end, whether a tool input was fully streamed, and when a provider step is finished.

MAGI's current `ModelStreamEvent` is narrower:

- `text_delta`
- `reasoning_start`
- `reasoning_delta`
- `reasoning_end`
- `tool_input_start`
- `tool_input_delta`
- `tool_input_end`
- `tool_call`
- `finish_step`

It lacks text block lifecycle, provider errors, usage, tool result events, provider metadata, and a full finish event.

### 3. OpenCode Separates Protocol From Transport

OpenCode has a protocol boundary:

```ts
Protocol<Body, Frame, Event, State>
```

Each protocol owns:

- how a canonical request becomes a provider-native body
- how one stream frame becomes a provider event
- how provider events become canonical stream events
- parser state for partial tool inputs, reasoning blocks, text blocks, and finish status

Transport owns:

- endpoint
- auth
- headers
- SSE framing
- WebSocket framing
- retries and HTTP diagnostics

MAGI currently mixes these concerns in `packages/core/src/model.ts`.

### 4. OpenCode Preserves Provider Metadata Through Session History

This is the critical difference for reasoning and tool continuation.

OpenCode's `publish-llm-event.ts` persists provider metadata from stream events into session message parts.

OpenCode's `to-llm-message.ts` later reconstructs typed model messages from persisted session messages. It only reuses provider metadata when the next request uses the same provider/model.

This prevents leaking OpenAI-specific state into Anthropic/Gemini requests, while still allowing OpenAI to continue native reasoning state.

### 5. OpenCode Round-Trips Tool Calls And Tool Results Natively

For a provider-native tool call, OpenCode stores an assistant `tool-call` part.

After local execution, it stores a `tool-result` part.

The next provider request receives these as native protocol items, not as plain observation text.

For OpenAI Responses this becomes:

```ts
{ type: "function_call", call_id, name, arguments }
{ type: "function_call_output", call_id, output }
```

For Anthropic this becomes tool-use/tool-result content blocks.

For Gemini this becomes function call/function response parts.

For Bedrock this becomes Converse tool use/tool result blocks.

The principle is provider-agnostic: tool calls and tool results are structured model history.

## Why The Bug Is Not OpenAI-Only

OpenAI Responses made the issue obvious, but every native protocol has a similar class of state that gets lost if MAGI converts everything into text.

### OpenAI Responses

OpenAI Responses has native input items:

- system messages
- user input content
- assistant output text
- reasoning items
- item references
- function calls
- function call outputs

Reasoning state must be preserved as:

```ts
{
  type: "reasoning",
  id: "rs_...",
  summary: [{ type: "summary_text", text: "..." }],
  encrypted_content: "..."
}
```

or, with persisted provider storage:

```ts
{ type: "item_reference", id: "rs_..." }
```

If MAGI sends a flattened user prompt, OpenAI cannot connect the next turn to previous reasoning/tool state.

### OpenAI Chat And OpenAI-Compatible Chat

OpenAI Chat streams tool call arguments by index and can include reasoning-like fields for compatible providers. The protocol still needs:

- accumulated tool-call arguments
- tool-call id/name preservation
- tool-result messages with matching tool call ids
- lifecycle finish mapping from `finish_reason`

Flattening tool results into user text removes the provider's native tool-call context.

### Anthropic Messages

Anthropic uses content blocks such as text, thinking/reasoning, tool use, and tool result. Tool results are not just text observations; they are part of the assistant/tool exchange.

If MAGI later wants Anthropic extended thinking, cache control, or tool-use parity, it needs typed parts and provider metadata.

### Gemini

Gemini has function calls and function responses. It also uses provider-specific content parts and finish reasons. A prompt-only loop cannot preserve structured function response history correctly.

### Bedrock Converse

Bedrock Converse uses content blocks with tool use/tool result and event-stream framing. It also has provider-specific reasoning and usage semantics. The same lifecycle/parser boundary applies.

## Current MAGI Architecture Gap

Relevant MAGI files:

- `packages/core/src/model.ts`
- `packages/core/src/model-tools.ts`
- `packages/core/src/agent/runner.ts`
- `packages/core/src/agent/runner-native-tools.ts`
- `packages/core/src/agent/runner-prompts.ts`
- `packages/core/src/agent/runner-types.ts`
- `packages/core/src/session.ts`
- `apps/tui/src/app-controller.tsx`
- `apps/tui/src/transcript-view.tsx`

### Current Model Boundary

MAGI currently has:

```ts
export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
};
```

This cannot represent:

- multiple content blocks inside one assistant message
- reasoning block ids
- encrypted reasoning state
- provider item ids
- native tool call item ids
- native tool result metadata
- media attachments
- cache hints
- provider-executed hosted tools
- typed tool result content

### Current Native Tool Loop

MAGI currently builds one text prompt per iteration:

```ts
messages: [{ role: "user", content: formatNativeToolPrompt(input) }]
```

The prompt contains:

- user request
- prior session context
- iteration count
- observations so far

This is useful for simple models and fallback JSON-action mode, but it is not native provider history.

### Current Observations

MAGI stores tool results as formatted observation strings:

```ts
state.observations.push(formatObservation(action, observation));
```

This means a provider sees previous tool results as ordinary user text, not as the structured result of the tool call it emitted.

### Current Parser Limitations

The first direct OpenAI parser in `model.ts` can parse selected events, but it still returns:

```ts
ModelStepResponse {
  text: string;
  reasoningText?: string;
  toolCalls: ModelToolCall[];
  finishReason?: string;
  streamStats?: ModelStreamStats;
}
```

This result loses:

- reasoning provider metadata
- encrypted reasoning content
- text block ids
- tool input provider item ids
- usage
- provider errors as typed events
- full assistant message parts for continuation

## Target Architecture For MAGI

MAGI does not need to copy OpenCode wholesale, but it needs the same boundaries.

### Canonical Model Types

Introduce provider-agnostic model message parts in `packages/core/src/model.ts` or a new `model-types.ts`:

```ts
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

export type ModelMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ModelContentPart[];
  toolCallId?: string;
};
```

Keep `content: string` temporarily for backward compatibility inside MAGI, but normalize it before protocol lowering.

### Canonical Stream Events

Expand `ModelStreamEvent` toward the OpenCode vocabulary:

```ts
type ModelStreamEvent =
  | { type: "step_start"; index: number }
  | { type: "text_start"; id: string; providerMetadata?: ModelProviderMetadata }
  | { type: "text_delta"; id?: string; text: string; providerMetadata?: ModelProviderMetadata }
  | { type: "text_end"; id: string; providerMetadata?: ModelProviderMetadata }
  | { type: "reasoning_start"; id: string; providerMetadata?: ModelProviderMetadata }
  | { type: "reasoning_delta"; id: string; text: string; providerMetadata?: ModelProviderMetadata }
  | { type: "reasoning_end"; id: string; providerMetadata?: ModelProviderMetadata }
  | { type: "tool_input_start"; id: string; toolName: string; providerMetadata?: ModelProviderMetadata }
  | { type: "tool_input_delta"; id: string; toolName?: string; delta: string }
  | { type: "tool_input_end"; id: string; toolName?: string; providerMetadata?: ModelProviderMetadata }
  | { type: "tool_call"; id: string; toolName: string; input: unknown; providerExecuted?: boolean; providerMetadata?: ModelProviderMetadata }
  | { type: "tool_result"; id: string; toolName: string; result: ModelToolResultValue; providerExecuted?: boolean; providerMetadata?: ModelProviderMetadata }
  | { type: "step_finish"; finishReason?: string; usage?: ModelUsage; providerMetadata?: ModelProviderMetadata }
  | { type: "finish"; finishReason?: string; usage?: ModelUsage; providerMetadata?: ModelProviderMetadata }
  | { type: "provider_error"; message: string; classification?: string; retryable?: boolean; providerMetadata?: ModelProviderMetadata };
```

MAGI can maintain aliases for current TUI payloads while internally moving toward this shape.

### Protocol Lowering

Each provider family should have a lowering function:

```txt
canonical ModelRequest
  -> OpenAI Responses body
  -> OpenAI Chat body
  -> Anthropic Messages body
  -> Gemini body
  -> Bedrock Converse body
```

The lowering function should be the only place that knows provider-native body details.

### Protocol Parser

Each provider family should have a parser:

```txt
provider stream frame/event
  -> canonical ModelStreamEvent[]
```

The parser should own temporary state for:

- text block ids
- reasoning block ids
- tool input accumulation
- provider stream item ids
- finish reason mapping
- usage mapping
- provider error mapping

### Session And Runner State

The runner needs a typed model history alongside the user-facing transcript.

At minimum, one run should maintain:

```ts
type ModelTurnHistory = ModelMessage[];
```

For every provider turn:

1. Add user message as typed user content.
2. Stream assistant events into an assistant message under construction.
3. When a tool call arrives, append a `tool-call` part to that assistant message.
4. Execute the local tool.
5. Append a `tool-result` message with matching id/name/result.
6. Continue with typed history, not flattened observations.

Observation strings may still exist for fallback JSON-action prompting and UI summaries, but native provider mode should not depend on them as the source of truth.

## OpenAI Responses Lowering Details

The OpenAI Responses body should be built from typed messages.

### System

```ts
{ role: "system", content: "..." }
```

### User Text

```ts
{ role: "user", content: [{ type: "input_text", text: "..." }] }
```

### Assistant Text

```ts
{ role: "assistant", content: [{ type: "output_text", text: "..." }] }
```

### Reasoning

When `store: false`, OpenAI accepts previous reasoning items only when encrypted state exists:

```ts
{
  type: "reasoning",
  id: itemId,
  summary: text.length > 0 ? [{ type: "summary_text", text }] : [],
  encrypted_content: encryptedContent
}
```

If encrypted content is missing under `store: false`, the reasoning item should be omitted. This matches OpenCode's filtering behavior.

When `store: true` and a previous `itemId` exists, use:

```ts
{ type: "item_reference", id: itemId }
```

### Tool Call

```ts
{
  type: "function_call",
  call_id: part.id,
  name: part.name,
  arguments: JSON.stringify(part.input)
}
```

### Tool Result

```ts
{
  type: "function_call_output",
  call_id: part.id,
  output: resultTextOrContent
}
```

### Request Options

OpenAI-specific options should be explicit provider options, not scattered literals:

```ts
providerOptions: {
  openai: {
    store: false,
    include: ["reasoning.encrypted_content"],
    reasoningSummary: "auto",
    promptCacheKey,
    instructions,
  }
}
```

MAGI can initially hardcode the OAuth defaults, but the implementation should shape them as provider options so later config can override them.

## OpenAI Responses Parser Details

MAGI's parser should mirror these OpenCode behaviors.

### Text

`response.output_text.delta` should emit text lifecycle events.

If no text start was emitted for the item id, start it automatically.

At finish, close open text blocks.

### Reasoning

Handle these delta aliases:

- `response.reasoning_text.delta`
- `response.reasoning_summary.delta`
- `response.reasoning_summary_text.delta`

Handle these done aliases:

- `response.reasoning_text.done`
- `response.reasoning_summary.done`
- `response.reasoning_summary_text.done`
- `response.reasoning_summary_part.done`

For reasoning item added:

```ts
response.output_item.added item.type === "reasoning"
```

emit:

```ts
reasoning_start({
  id: `${item.id}:0`,
  providerMetadata: {
    openai: {
      itemId: item.id,
      reasoningEncryptedContent: item.encrypted_content ?? null,
    }
  }
})
```

On reasoning end, emit the latest provider metadata so the session can store encrypted content even when no plaintext summary was emitted.

### Tool Input

`response.output_item.added` with `item.type === "function_call"` starts tool input using `item.id` as the stream key and `item.call_id` as public tool-call id.

`response.function_call_arguments.delta` appends raw JSON argument text.

`response.output_item.done` finalizes the tool call. If `item.arguments` is present, it wins over accumulated deltas.

Tool calls should carry:

```ts
providerMetadata: { openai: { itemId: item.id } }
```

### Finish

`response.completed` and `response.incomplete` should emit:

- close open text/reasoning blocks
- `step_finish`
- `finish`

Finish reason mapping:

- no incomplete reason + function calls: `tool-calls`
- no incomplete reason + no function calls: `stop`
- `max_output_tokens`: `length`
- `content_filter`: `content-filter`
- unknown incomplete with function calls: `tool-calls`
- unknown incomplete without function calls: `unknown`

Usage should preserve provider raw usage and normalized fields.

## Implementation Phases

### Phase 1: Canonical Types Without Large Runner Rewrite

Goal: add typed model parts and provider metadata while keeping existing public flow mostly intact.

Tasks:

- Add `ModelContentPart`, `ModelProviderMetadata`, `ModelUsage`, and `ModelToolResultValue`.
- Change `ModelMessage.content` to `string | ModelContentPart[]`.
- Add helpers to normalize string messages into text parts.
- Extend `ModelToolCall` with optional `providerMetadata` and `providerExecuted`.
- Extend `ModelStreamEvent` with optional provider metadata where needed.
- Keep existing TUI stream mapping working.

Acceptance tests:

- Existing model tests pass.
- Existing runner tests pass.
- No TUI typecheck regression.

### Phase 2: OpenAI Responses Lowering From Typed Messages

Goal: remove single-prompt lowering for OpenAI OAuth native tool mode.

Tasks:

- Implement `formatOpenAIResponsesInput(messages, store)`.
- Implement `formatOpenAIResponsesToolDefinition()` using OpenAI-compatible JSON Schema.
- Build OAuth request body from typed messages.
- Keep fallback string messages working by mapping them to role-native text content.

Acceptance tests:

- User text lowers to OpenAI Responses user item.
- Assistant text lowers to assistant output text.
- Tool call lowers to `function_call`.
- Tool result lowers to `function_call_output`.
- Reasoning with encrypted state and `store:false` lowers to `reasoning` item.
- Reasoning without encrypted state and `store:false` is omitted.
- Reasoning with `store:true` lowers to `item_reference`.

### Phase 3: Parser Provider Metadata Preservation

Goal: preserve provider metadata from stream parser to response/tool calls.

Tasks:

- Add provider metadata to reasoning events.
- Add provider metadata to tool call events.
- Add usage and finish metadata where available.
- Update `ModelStepResponse` to include assistant content parts, not only joined text/reasoning.

Acceptance tests:

- SSE fixture with encrypted reasoning emits a reasoning part carrying `reasoningEncryptedContent`.
- SSE fixture with tool call emits `tool_call.providerMetadata.openai.itemId`.
- Completed response emits normalized finish reason and usage.

### Phase 4: Runner Typed Native History

Goal: native tool mode should continue using typed model history instead of observation text.

Tasks:

- Add typed history state to `RunState`.
- Seed typed history with the user request.
- During native provider turn, collect assistant parts from stream/result.
- When tool calls execute, append tool-result messages with matching ids.
- Continue the next native iteration using typed history.
- Keep observation strings for guardrails, fallback JSON-action prompting, and final summaries.

Acceptance tests:

- First native turn tool call leads to second native request containing `function_call` and `function_call_output` items.
- Repeated tool guard still works.
- All-skipped fallback still works.
- Final text-only fallback still works.

### Phase 5: Session Persistence Parity

Goal: persist typed parts across process/session boundaries.

Tasks:

- Extend session event payloads or add assistant message part persistence for provider metadata.
- Store reasoning start/delta/end with provider metadata.
- Store tool call provider metadata.
- Store tool result provider metadata.
- Rebuild typed model history from session events.

Acceptance tests:

- Reloaded session can reconstruct OpenAI reasoning item metadata.
- Reloaded session can reconstruct tool-call/tool-result pairs.

### Phase 6: Multi-Provider Protocol Extraction

Goal: move provider-specific logic out of `model.ts`.

Tasks:

- Create `packages/core/src/model-protocols/`.
- Move OpenAI Responses lowering/parser there.
- Add protocol interface for future OpenAI Chat, Anthropic, Gemini, Bedrock.
- Keep AI SDK fallback path until each provider has native protocol support.

Acceptance tests:

- OpenAI OAuth path uses protocol module.
- Non-OAuth providers still pass existing tests.
- Protocol tests are isolated from runner tests.

## Immediate Coding Strategy

The smallest safe next implementation slice is not a full OpenCode clone. It is:

1. Add canonical typed parts and metadata to MAGI model types.
2. Implement OpenAI Responses request lowering from those typed parts.
3. Modify the parser to output assistant content parts with provider metadata.
4. Modify runner native state so the next OpenAI request can include prior tool-call/tool-result parts.

This fixes the root continuation issue for OpenAI while creating the shape needed for Anthropic/Gemini/Bedrock parity.

## Non-Goals For The First Slice

- Do not add a full Effect-based route/client framework.
- Do not port all OpenCode protocols at once.
- Do not remove fallback JSON action mode.
- Do not redesign the TUI transcript schema in the same slice unless required by type safety.
- Do not attempt to decrypt encrypted reasoning.

## Risks

### Mixed History Risk

If one provider's metadata is sent to another provider, requests can become invalid or semantically wrong.

Mitigation:

- Only lower provider metadata for the same provider family.
- Treat unknown provider metadata as opaque and do not serialize it into other provider requests.

### Store Mode Risk

OpenAI `store:false` and `store:true` have different continuation behavior.

Mitigation:

- Encode `store` in provider options.
- Test both modes.
- For `store:false`, include only reasoning items with encrypted state.

### UI Compatibility Risk

Existing TUI expects simplified stream events.

Mitigation:

- Keep existing `assistant_stream` payload kinds initially.
- Add metadata as optional fields.
- Introduce richer persistence separately.

### Regression Risk In Fallback Providers

Non-OAuth providers still use AI SDK `generateText`/`streamText` behavior.

Mitigation:

- Normalize string content for existing paths.
- Keep fallback JSON-action mode unchanged.
- Run existing runner/model tests after each slice.

## Test Checklist

OpenAI Responses request lowering:

- user text
- system content
- assistant text
- tool call
- tool result
- reasoning encrypted `store:false`
- reasoning no encrypted `store:false`
- reasoning reference `store:true`
- multiple reasoning summary parts

OpenAI Responses parser:

- output text delta lifecycle
- reasoning item added with encrypted content
- reasoning summary delta
- encrypted-only reasoning
- function call argument deltas
- final function call arguments override
- completed finish reason
- incomplete finish reason
- provider error event
- usage mapping

Runner native history:

- first turn tool call, second turn receives function_call and function_call_output
- tool result error preserved as structured result
- repeated tool skip does not corrupt model history
- final answer text emitted after tool results

Cross-provider safety:

- OpenAI metadata not serialized into non-OpenAI request lowering
- string-only messages still work for AI SDK fallback

## References From OpenCode Tests

OpenCode has useful regression examples in `/Users/alma/Development/opencode/packages/opencode/test/session/llm-native.test.ts`:

- `compiles through the native OpenAI Responses route`
- `omits non-persisted OpenAI reasoning ids without encrypted state`
- `preserves encrypted OpenAI reasoning state through native request lowering`
- `preserves empty encrypted OpenAI reasoning items before tool output`
- `references stored OpenAI reasoning items by id`
- `uses provider fetch override for native OpenAI OAuth requests`

MAGI should add analogous tests in `packages/core/src/model-oauth-responses.test.ts` and runner tests.

## Working Conclusion

The fix is not “parse more OpenAI event names”.

The fix is to introduce a provider-neutral, typed model protocol boundary in MAGI and use provider-specific lowering/parsing behind that boundary.

OpenAI Responses should be the first implementation because it is where the bug is visible and where encrypted reasoning requires strict metadata preservation. But the abstraction must be provider-agnostic so Anthropic, Gemini, Bedrock, OpenAI Chat, and OpenAI-compatible providers can be brought to parity without repeating the same mistake.
