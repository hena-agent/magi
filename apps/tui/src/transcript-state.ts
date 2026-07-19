import { formatTranscriptMessageLines, type TranscriptLine } from "./transcript-format.js";
import type { TranscriptMessage } from "./transcript-types.js";

export const transcriptLineLimit = 28;

export type TranscriptLineRange = { start: number; end: number };

export function getTranscriptLines(input: {
  messages: TranscriptMessage[];
  selectedId: string | undefined;
  expandedIds: Set<string>;
}): TranscriptLine[] {
  return input.messages.flatMap((message, index) =>
    formatTranscriptMessageLines({
      message,
      first: index === 0,
      selectedId: input.selectedId,
      expandedIds: input.expandedIds,
    }),
  );
}

export function getTranscriptVisibleLineWindow(input: {
  messages: TranscriptMessage[];
  selectedId: string | undefined;
  expandedIds: Set<string>;
  scrollOffset: number;
  lineLimit?: number;
}): {
  lines: TranscriptLine[];
  visibleLines: TranscriptLine[];
  start: number;
  end: number;
  olderHiddenCount: number;
  newerHiddenCount: number;
} {
  const lines = getTranscriptLines(input);
  const lineLimit = input.lineLimit ?? transcriptLineLimit;
  const end = Math.max(0, lines.length - input.scrollOffset);
  const start = Math.max(0, end - lineLimit);

  return {
    lines,
    visibleLines: lines.slice(start, end),
    start,
    end,
    olderHiddenCount: start,
    newerHiddenCount: lines.length - end,
  };
}

export function getTranscriptLineCount(
  messages: TranscriptMessage[],
  expandedIds: Set<string>,
): number {
  return getTranscriptLines({ messages, selectedId: undefined, expandedIds }).length;
}

export function getTranscriptMessageLineCount(input: {
  message: TranscriptMessage;
  expandedIds: Set<string>;
  first?: boolean;
}): number {
  return formatTranscriptMessageLines({
    message: input.message,
    first: input.first ?? false,
    selectedId: undefined,
    expandedIds: input.expandedIds,
  }).length;
}

export function getTranscriptMaxScrollOffset(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  lineLimit?: number;
}): number {
  return Math.max(
    0,
    getTranscriptLineCount(input.messages, input.expandedIds) -
      (input.lineLimit ?? transcriptLineLimit),
  );
}

export function getTranscriptMessageLineRange(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  messageId: string;
}): TranscriptLineRange | undefined {
  let start = 0;

  for (const [index, message] of input.messages.entries()) {
    const lineCount = getTranscriptMessageLineCount({
      message,
      first: index === 0,
      expandedIds: input.expandedIds,
    });
    const end = start + lineCount;
    if (
      message.id === input.messageId ||
      message.parts.some((part) => part.id === input.messageId)
    ) {
      return { start, end };
    }

    start = end;
  }

  return undefined;
}

export function getSelectableTranscriptIds(messages: TranscriptMessage[]): string[] {
  return messages.flatMap((message) => {
    const ids = [message.id];
    ids.push(
      ...message.parts
        .filter((part) => part.type === "reasoning" || part.type === "tool")
        .map((part) => part.id),
    );
    return ids;
  });
}

export function isExpandableTranscriptId(messages: TranscriptMessage[], id: string): boolean {
  return messages.some((message) =>
    message.parts.some(
      (part) => (part.type === "reasoning" || part.type === "tool") && part.id === id,
    ),
  );
}

export function selectTranscriptId(input: {
  messages: TranscriptMessage[];
  selectedId: string | undefined;
  direction: number;
}): string | undefined {
  const selectableIds = getSelectableTranscriptIds(input.messages);
  if (selectableIds.length === 0) return undefined;

  const currentIndex = input.selectedId
    ? selectableIds.indexOf(input.selectedId)
    : selectableIds.length - 1;
  const normalizedIndex = currentIndex === -1 ? selectableIds.length - 1 : currentIndex;
  const nextIndex = Math.max(
    0,
    Math.min(selectableIds.length - 1, normalizedIndex + input.direction),
  );

  return selectableIds[nextIndex];
}

export function clampTranscriptScrollOffset(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  offset: number;
  lineLimit?: number;
}): number {
  return Math.max(0, Math.min(getTranscriptMaxScrollOffset(input), input.offset));
}

export function keepTranscriptMessageOffsetVisible(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  messageId: string;
  offset: number;
  lineLimit?: number;
}): number {
  const range = getTranscriptMessageLineRange(input);
  if (!range) return input.offset;

  const lineLimit = input.lineLimit ?? transcriptLineLimit;
  const totalLines = getTranscriptLineCount(input.messages, input.expandedIds);
  const visibleEnd = totalLines - input.offset;
  const visibleStart = Math.max(0, visibleEnd - lineLimit);

  if (range.start < visibleStart) {
    return totalLines - Math.min(totalLines, range.start + lineLimit);
  }

  if (range.end > visibleEnd) {
    return totalLines - range.end;
  }

  return input.offset;
}
