import type { TranscriptMessage, TranscriptPart } from "./transcript-types.js";

export function upsertTranscriptPart(
  message: TranscriptMessage,
  part: TranscriptPart,
): TranscriptMessage {
  const index = message.parts.findIndex((candidate) => candidate.id === part.id);
  if (index === -1) return { ...message, parts: [...message.parts, part] };

  return {
    ...message,
    parts: message.parts.map((candidate, candidateIndex) =>
      candidateIndex === index ? mergeTranscriptPart(candidate, part) : candidate,
    ),
  };
}

export function mergeTranscriptPart(
  existing: TranscriptPart,
  next: TranscriptPart,
): TranscriptPart {
  if (existing.type === "tool" && next.type === "tool") {
    const status = laterToolStatus(existing.state.status, next.state.status);
    const nextState = definedEntries(next.state);
    return {
      ...existing,
      ...next,
      state: {
        ...existing.state,
        ...nextState,
        status,
        metadata: { ...existing.state.metadata, ...next.state.metadata },
        time: {
          start:
            next.state.metadata?.durationMs === undefined
              ? existing.state.time.start
              : next.state.time.start,
          end: next.state.time.end ?? existing.state.time.end,
        },
      },
    };
  }

  if (existing.type === "reasoning" && next.type === "reasoning") {
    return {
      ...existing,
      ...next,
      time: { start: existing.time.start, end: next.time.end ?? existing.time.end },
    };
  }

  return next;
}

function definedEntries<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  ) as Partial<T>;
}

function laterToolStatus(
  existing: Extract<TranscriptPart, { type: "tool" }>["state"]["status"],
  next: Extract<TranscriptPart, { type: "tool" }>["state"]["status"],
): Extract<TranscriptPart, { type: "tool" }>["state"]["status"] {
  const rank = (status: typeof existing): number =>
    status === "pending" ? 0 : status === "running" ? 1 : 2;
  return rank(next) >= rank(existing) ? next : existing;
}

export function findToolInput(messages: TranscriptMessage[], toolCallId: string): unknown {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool" && part.id === `tool:${toolCallId}`) return part.state.input;
    }
  }

  return undefined;
}

export function findMatchingToolPartId(
  message: TranscriptMessage,
  toolName: string,
  input: unknown,
  toolCallId?: string,
): string {
  const preferredId = toolCallId === undefined ? undefined : `tool:${toolCallId}`;
  if (preferredId !== undefined && message.parts.some((part) => part.id === preferredId)) {
    return preferredId;
  }

  const matchingPart = message.parts.find(
    (part): part is Extract<TranscriptPart, { type: "tool" }> =>
      part.type === "tool" && part.tool === toolName && toolInputsEqual(part.state.input, input),
  );

  return matchingPart?.id ?? preferredId ?? `tool:${toolName}:${stableStringify(input)}`;
}

export function isSameToolPart(
  part: TranscriptPart,
  call: { id: string; name: string; input: unknown },
): boolean {
  if (part.type !== "tool") return false;
  if (part.id === `tool:${call.id}`) return true;
  if (part.tool !== call.name) return false;

  return toolInputsEqual(part.state.input, call.input);
}

export function toolInputsEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}
