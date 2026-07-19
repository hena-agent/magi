import {
  clampTranscriptScrollOffset,
  getTranscriptLineCount,
  isExpandableTranscriptId,
  keepTranscriptMessageOffsetVisible,
  selectTranscriptId,
} from "./transcript-state.js";
import type { TranscriptMessage } from "./transcript-types.js";

export function clampTranscriptOffset(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  offset: number;
  lineLimit?: number;
}): number {
  return clampTranscriptScrollOffset(input);
}

export function scrollTranscriptOffset(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  offset: number;
  delta: number;
  lineLimit?: number;
}): number {
  return clampTranscriptOffset({
    messages: input.messages,
    expandedIds: input.expandedIds,
    offset: input.offset + input.delta,
    lineLimit: input.lineLimit,
  });
}

export function scrollTranscriptToStartOffset(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  lineLimit?: number;
}): number {
  return clampTranscriptOffset({
    messages: input.messages,
    expandedIds: input.expandedIds,
    offset: getTranscriptLineCount(input.messages, input.expandedIds),
    lineLimit: input.lineLimit,
  });
}

export function selectTranscriptNavigation(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  selectedId: string | undefined;
  scrollOffset: number;
  direction: number;
  lineLimit?: number;
}): { selectedId: string | undefined; scrollOffset: number } {
  const nextSelectedId = selectTranscriptId({
    messages: input.messages,
    selectedId: input.selectedId,
    direction: input.direction,
  });
  if (!nextSelectedId) {
    return { selectedId: input.selectedId, scrollOffset: input.scrollOffset };
  }

  const visibleOffset = keepTranscriptMessageOffsetVisible({
    messages: input.messages,
    expandedIds: input.expandedIds,
    messageId: nextSelectedId,
    offset: input.scrollOffset,
    lineLimit: input.lineLimit,
  });

  return {
    selectedId: nextSelectedId,
    scrollOffset: clampTranscriptOffset({
      messages: input.messages,
      expandedIds: input.expandedIds,
      offset: visibleOffset,
      lineLimit: input.lineLimit,
    }),
  };
}

export function toggleTranscriptExpansion(input: {
  messages: TranscriptMessage[];
  expandedIds: Set<string>;
  selectedId: string | undefined;
  scrollOffset: number;
  lineLimit?: number;
}): { expandedIds: Set<string>; scrollOffset: number } {
  if (!input.selectedId || !isExpandableTranscriptId(input.messages, input.selectedId)) {
    return { expandedIds: input.expandedIds, scrollOffset: input.scrollOffset };
  }

  const nextExpandedIds = new Set(input.expandedIds);
  if (nextExpandedIds.has(input.selectedId)) {
    nextExpandedIds.delete(input.selectedId);
  } else {
    nextExpandedIds.add(input.selectedId);
  }

  const visibleOffset = keepTranscriptMessageOffsetVisible({
    messages: input.messages,
    expandedIds: nextExpandedIds,
    messageId: input.selectedId,
    offset: input.scrollOffset,
    lineLimit: input.lineLimit,
  });

  return {
    expandedIds: nextExpandedIds,
    scrollOffset: clampTranscriptOffset({
      messages: input.messages,
      expandedIds: nextExpandedIds,
      offset: visibleOffset,
      lineLimit: input.lineLimit,
    }),
  };
}
