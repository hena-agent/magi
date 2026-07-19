// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Persisted event reconciliation is intentionally auditable in one state machine.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Event ordering and legacy fallback state must remain local.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: The resume state machine is isolated from rendering and live controller state.
import type { SessionEvent, ToolResult } from "@magi/core";
import { formatSessionEventSummary } from "./session-event-format.js";
import { findMatchingToolPartId, findToolInput, upsertTranscriptPart } from "./transcript-parts.js";
import {
  createToolPartFromInput,
  formatToolInputTarget,
  formatToolResultSummary,
  parseJsonInput,
} from "./transcript-tool-display.js";
import type {
  TranscriptMessage,
  TranscriptPart,
  TranscriptToolStatus,
} from "./transcript-types.js";

type AssistantMetadata = { agentId?: unknown; providerId?: unknown; model?: unknown };

export function sessionEventsToTranscriptMessages(
  events: SessionEvent[],
  limit: number,
): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  const assistants = new Map<string, TranscriptMessage>();
  const toolOwners = indexPersistedToolOwners(events);
  const settledTools = new Set(
    events.flatMap((event) => {
      if (event.type !== "tool_settlement") return [];
      const payload = event.payload as { toolCallId?: unknown };
      return typeof payload.toolCallId === "string" ? [payload.toolCallId] : [];
    }),
  );
  const reasoningStarts = new Map<string, number>();
  const reasoningTexts = new Map<string, string>();
  const toolInputs = new Map<
    string,
    { toolName: string; raw: string; input?: unknown; startedAt: number }
  >();
  let legacyAssistantId: string | undefined;

  const eventTime = (event: SessionEvent): number => Date.parse(event.createdAt);
  const appendSystem = (event: SessionEvent, text = formatSessionEventSummary(event)) =>
    messages.push({
      id: event.id,
      role: "system",
      createdAt: eventTime(event),
      parts: [{ id: `${event.id}:status`, type: "status", text, tone: "muted" }],
    });
  const ensureAssistant = (
    id: string,
    event: SessionEvent,
    metadata?: AssistantMetadata,
  ): TranscriptMessage => {
    const existing = assistants.get(id);
    if (existing) {
      existing.agentId ??= stringValue(metadata?.agentId);
      existing.providerId ??= stringValue(metadata?.providerId);
      existing.model ??= stringValue(metadata?.model);
      return existing;
    }
    const message: TranscriptMessage = {
      id,
      role: "assistant",
      agentId: stringValue(metadata?.agentId),
      providerId: stringValue(metadata?.providerId),
      model: stringValue(metadata?.model),
      createdAt: eventTime(event),
      parts: [],
    };
    assistants.set(id, message);
    messages.push(message);
    return message;
  };
  const updateAssistant = (
    id: string,
    event: SessionEvent,
    part: TranscriptPart,
    metadata?: AssistantMetadata,
  ): TranscriptMessage => {
    const message = ensureAssistant(id, event, metadata);
    const updated = upsertTranscriptPart(message, part);
    Object.assign(message, updated);
    return message;
  };
  const ownerForTool = (toolCallId: string, event: SessionEvent): string => {
    const known = toolOwners.get(toolCallId);
    if (known) return known;
    const fallback = legacyAssistantId ?? `assistant:${event.id}`;
    toolOwners.set(toolCallId, fallback);
    return fallback;
  };

  for (const event of events) {
    switch (event.type) {
      case "user_message": {
        legacyAssistantId = undefined;
        const payload = event.payload as AssistantMetadata & { content?: unknown };
        if (typeof payload.content !== "string") break;
        messages.push({
          id: `${event.id}-user`,
          role: "user",
          agentId: stringValue(payload.agentId),
          providerId: stringValue(payload.providerId),
          createdAt: eventTime(event),
          parts: [{ id: `${event.id}-text`, type: "text", text: truncate(payload.content) }],
        });
        break;
      }
      case "agent_step_started":
      case "assistant_started": {
        const payload = event.payload as AssistantMetadata & { runId?: unknown; stepId?: unknown };
        const id = assistantId(payload);
        if (id) {
          legacyAssistantId = id;
          ensureAssistant(id, event, payload);
        }
        break;
      }
      case "assistant_status": {
        const payload = event.payload as AssistantMetadata & {
          runId?: unknown;
          stepId?: unknown;
          text?: unknown;
          kind?: unknown;
        };
        if (typeof payload.text !== "string") break;
        const id = assistantId(payload) ?? legacyAssistantId ?? `assistant:${event.id}`;
        legacyAssistantId = id;
        updateAssistant(
          id,
          event,
          payload.kind === "reasoning"
            ? {
                id: `${event.id}:reasoning`,
                type: "reasoning",
                text: payload.text,
                time: { start: eventTime(event), end: eventTime(event) },
              }
            : { id: `${event.id}:status`, type: "status", text: payload.text, tone: "muted" },
          payload,
        );
        break;
      }
      case "assistant_stream": {
        const payload = event.payload as AssistantMetadata & Record<string, unknown>;
        const id = assistantId(payload);
        if (!id) break;
        legacyAssistantId = id;
        const kind = payload.kind;
        if (kind === "text_delta" && typeof payload.text === "string") {
          const message = ensureAssistant(id, event, payload);
          const text = message.parts.find(
            (part): part is Extract<TranscriptPart, { type: "text" }> =>
              part.type === "text" && part.id === `${id}:text`,
          )?.text;
          updateAssistant(
            id,
            event,
            { id: `${id}:text`, type: "text", text: `${text ?? ""}${payload.text}` },
            payload,
          );
        } else if (kind === "reasoning_start" && typeof payload.id === "string") {
          reasoningStarts.set(payload.id, eventTime(event));
          reasoningTexts.set(payload.id, "");
          updateAssistant(id, event, {
            id: `reasoning:${payload.id}`,
            type: "reasoning",
            text: "",
            time: { start: eventTime(event) },
          });
        } else if (
          kind === "reasoning_delta" &&
          typeof payload.id === "string" &&
          typeof payload.text === "string"
        ) {
          const text = `${reasoningTexts.get(payload.id) ?? ""}${payload.text}`;
          reasoningTexts.set(payload.id, text);
          updateAssistant(id, event, {
            id: `reasoning:${payload.id}`,
            type: "reasoning",
            text,
            time: { start: reasoningStarts.get(payload.id) ?? eventTime(event) },
          });
        } else if (kind === "reasoning_end" && typeof payload.id === "string") {
          updateAssistant(id, event, {
            id: `reasoning:${payload.id}`,
            type: "reasoning",
            text: reasoningTexts.get(payload.id) ?? "",
            time: {
              start: reasoningStarts.get(payload.id) ?? eventTime(event),
              end: eventTime(event),
            },
          });
        } else if (
          kind === "tool_input_start" &&
          typeof payload.id === "string" &&
          typeof payload.toolName === "string"
        ) {
          toolOwners.set(payload.id, id);
          toolInputs.set(payload.id, {
            toolName: payload.toolName,
            raw: "",
            startedAt: eventTime(event),
          });
          updateAssistant(
            id,
            event,
            createToolPartFromInput(
              `tool:${payload.id}`,
              payload.toolName,
              undefined,
              "pending",
              eventTime(event),
            ),
          );
        } else if (
          kind === "tool_input_delta" &&
          typeof payload.id === "string" &&
          typeof payload.delta === "string"
        ) {
          const current = toolInputs.get(payload.id) ?? {
            toolName: "tool",
            raw: "",
            startedAt: eventTime(event),
          };
          const raw = `${current.raw}${payload.delta}`;
          const input = parseJsonInput(raw);
          toolInputs.set(payload.id, { ...current, raw, input });
          updateAssistant(
            id,
            event,
            createToolPartFromInput(
              `tool:${payload.id}`,
              current.toolName,
              input,
              "pending",
              current.startedAt,
            ),
          );
        } else if (kind === "tool_input_end" && typeof payload.id === "string") {
          const current = toolInputs.get(payload.id);
          if (current)
            updateAssistant(
              id,
              event,
              createToolPartFromInput(
                `tool:${payload.id}`,
                current.toolName,
                current.input ?? parseJsonInput(current.raw),
                "pending",
                current.startedAt,
              ),
            );
        } else if (
          kind === "tool_call" &&
          typeof payload.id === "string" &&
          typeof payload.toolName === "string"
        ) {
          toolOwners.set(payload.id, id);
          updateAssistant(
            id,
            event,
            createToolPartFromInput(
              `tool:${payload.id}`,
              payload.toolName,
              payload.input,
              "running",
              eventTime(event),
            ),
          );
        }
        // finish_step is structural; agent_step_ended carries the persisted outcome.
        break;
      }
      case "assistant_message": {
        const payload = event.payload as AssistantMetadata & {
          content?: unknown;
          runId?: unknown;
          stepId?: unknown;
        };
        if (typeof payload.content !== "string") break;
        const explicitId = assistantId(payload);
        const id = explicitId ?? legacyAssistantId ?? event.id;
        legacyAssistantId = id;
        const message = ensureAssistant(id, event, payload);
        const partId = explicitId ? `${id}:text` : `${id}:text`;
        const streamed = message.parts.find(
          (part): part is Extract<TranscriptPart, { type: "text" }> =>
            part.type === "text" && part.id === partId,
        )?.text;
        updateAssistant(
          id,
          event,
          {
            id: partId,
            type: "text",
            text: truncate(reconcileFinalText(streamed, payload.content)),
          },
          payload,
        ).completedAt = eventTime(event);
        break;
      }
      case "tool_call": {
        const payload = event.payload as { id?: unknown; name?: unknown; input?: unknown };
        if (typeof payload.id !== "string" || typeof payload.name !== "string") break;
        const owner = ownerForTool(payload.id, event);
        updateAssistant(
          owner,
          event,
          createToolPartFromInput(
            `tool:${payload.id}`,
            payload.name,
            payload.input,
            "running",
            eventTime(event),
          ),
        );
        break;
      }
      case "tool_result": {
        const payload = event.payload as {
          id?: unknown;
          name?: unknown;
          ok?: unknown;
          output?: unknown;
          error?: unknown;
        };
        if (
          typeof payload.id !== "string" ||
          typeof payload.name !== "string" ||
          typeof payload.ok !== "boolean" ||
          typeof payload.output !== "string"
        )
          break;
        const owner = ownerForTool(payload.id, event);
        const input = findToolInput(messages, payload.id);
        const result: ToolResult = {
          id: payload.id,
          name: payload.name as ToolResult["name"],
          ok: payload.ok,
          output: payload.output,
          error: stringValue(payload.error),
        };
        const summary = formatToolResultSummary(result, input);
        updateAssistant(owner, event, {
          id: `tool:${payload.id}`,
          type: "tool",
          tool: payload.name,
          state: {
            status: payload.ok ? "completed" : "error",
            input,
            output: payload.ok ? payload.output.trim() : undefined,
            error: payload.ok ? undefined : (stringValue(payload.error) ?? payload.output),
            title: summary.content,
            metadata: summaryMetadata(summary),
            time: { start: eventTime(event), end: eventTime(event) },
          },
        });
        break;
      }
      case "tool_settlement": {
        const payload = event.payload as Record<string, unknown>;
        if (typeof payload.toolCallId !== "string" || typeof payload.name !== "string") break;
        const status = settlementStatus(payload.status);
        if (!status) break;
        const owner = ownerForTool(payload.toolCallId, event);
        const existingInput = findToolInput(messages, payload.toolCallId);
        const start = parseTime(payload.startedAt) ?? eventTime(event);
        const end = parseTime(payload.endedAt);
        const durationMs = typeof payload.durationMs === "number" ? payload.durationMs : undefined;
        updateAssistant(owner, event, {
          id: `tool:${payload.toolCallId}`,
          type: "tool",
          tool: payload.name,
          state: {
            status,
            input: payload.input ?? existingInput,
            output: status === "completed" ? stringValue(payload.outputPreview) : undefined,
            error:
              stringValue(payload.error) ??
              (status === "denied"
                ? "permission denied"
                : status === "interrupted"
                  ? "interrupted"
                  : undefined),
            metadata: {
              ...(durationMs === undefined ? {} : { durationMs }),
              ...targetMetadata(payload.name, payload.input ?? existingInput),
              ...(typeof payload.outputPreview === "string"
                ? { preview: payload.outputPreview }
                : {}),
            },
            time: {
              start: end !== undefined && durationMs !== undefined ? end - durationMs : start,
              ...(end === undefined ? {} : { end }),
            },
          },
        });
        break;
      }
      case "agent_tool_skipped": {
        const payload = event.payload as AssistantMetadata & Record<string, unknown>;
        const id = assistantId(payload);
        if (!id || typeof payload.toolName !== "string") break;
        const toolCallId = stringValue(payload.toolCallId);
        if (toolCallId) toolOwners.set(toolCallId, id);
        const message = ensureAssistant(id, event, payload);
        updateAssistant(id, event, {
          id: findMatchingToolPartId(message, payload.toolName, payload.input, toolCallId),
          type: "tool",
          tool: payload.toolName,
          state: {
            status: "skipped",
            input: payload.input,
            error: stringValue(payload.reason),
            title: "skipped repeated action",
            metadata: {
              ...targetMetadata(payload.toolName, payload.input),
              ...(typeof payload.reason === "string" ? { summary: payload.reason } : {}),
            },
            time: { start: eventTime(event), end: eventTime(event) },
          },
        });
        break;
      }
      case "provider_error": {
        const payload = event.payload as AssistantMetadata & Record<string, unknown>;
        const id = assistantId(payload);
        if (!id) appendSystem(event);
        else
          updateAssistant(id, event, {
            id: `provider-error:${id}`,
            type: "status",
            text: typeof payload.message === "string" ? payload.message : "provider error",
            tone: "danger",
          });
        break;
      }
      case "permission_decision": {
        const payload = event.payload as { toolCallId?: unknown; decision?: unknown };
        // Allow decisions and denials represented by a settlement card are intentionally not duplicated.
        if (
          payload.decision === "deny" &&
          (typeof payload.toolCallId !== "string" || !settledTools.has(payload.toolCallId))
        )
          appendSystem(event);
        break;
      }
      case "agent_step_ended":
        // Structural lifecycle event; failures are surfaced by provider_error/interruption/tool cards.
        break;
      case "interruption":
      case "context_summary":
      case "queued_user_input":
      case "proposed_patch":
      case "verification_result":
      case "agent_switch":
      case "model_switch":
      case "todo_update":
      case "task_update":
      case "plan_exit":
      case "summary":
      case "magi_decision_trail":
        appendSystem(event);
        break;
      default:
        assertNever(event.type);
    }
  }

  return messages.slice(-limit);
}

function assertNever(value: never): never {
  throw new Error(`Unhandled session event type: ${String(value)}`);
}

function indexPersistedToolOwners(events: SessionEvent[]): Map<string, string> {
  const owners = new Map<string, string>();
  for (const event of events) {
    if (event.type !== "assistant_stream" && event.type !== "agent_tool_skipped") continue;
    const payload = event.payload as Record<string, unknown>;
    const id = assistantId(payload);
    const toolCallId = event.type === "agent_tool_skipped" ? payload.toolCallId : payload.id;
    if (id && typeof toolCallId === "string") owners.set(toolCallId, id);
  }
  return owners;
}

function assistantId(payload: object): string | undefined {
  const candidate = payload as { runId?: unknown; stepId?: unknown };
  return typeof candidate.runId === "string" && typeof candidate.stepId === "string"
    ? `assistant:${candidate.runId}:${candidate.stepId}`
    : undefined;
}

function reconcileFinalText(streamed: string | undefined, finalText: string): string {
  if (!streamed || finalText.includes(streamed)) return finalText;
  if (!finalText || streamed.includes(finalText)) return streamed;
  return finalText;
}

function settlementStatus(value: unknown): TranscriptToolStatus | undefined {
  switch (value) {
    case "pending":
    case "running":
    case "denied":
    case "interrupted":
      return value;
    case "succeeded":
      return "completed";
    case "failed":
      return "error";
    default:
      return undefined;
  }
}

function parseTime(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function targetMetadata(toolName: string, input: unknown): { target?: string } {
  const target = formatToolInputTarget(toolName, input);
  return target ? { target } : {};
}

function summaryMetadata(summary: ReturnType<typeof formatToolResultSummary>) {
  return {
    ...(summary.target ? { target: summary.target } : {}),
    ...(summary.countLabel ? { countLabel: summary.countLabel } : {}),
    ...(summary.summary ? { summary: summary.summary } : {}),
    ...(summary.preview ? { preview: summary.preview } : {}),
  };
}

function truncate(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}\n... truncated` : value;
}
