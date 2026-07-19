import { describe, expect, it } from "vitest";
import {
  clampTranscriptOffset,
  scrollTranscriptOffset,
  scrollTranscriptToStartOffset,
  selectTranscriptNavigation,
  toggleTranscriptExpansion,
} from "./transcript-navigation.js";
import type { TranscriptMessage } from "./transcript-types.js";

const messages: TranscriptMessage[] = [
  {
    id: "user-1",
    role: "user",
    parts: [{ id: "user-1:text", type: "text", text: "Fix this" }],
  },
  {
    id: "assistant-1",
    role: "assistant",
    parts: [
      {
        id: "reasoning-1",
        type: "reasoning",
        text: "Check repo\nFind fix",
        time: { start: 1_000, end: 1_200 },
      },
      { id: "assistant-1:text", type: "text", text: "Done" },
    ],
  },
];

describe("transcript scroll navigation helpers", () => {
  it("clamps and scrolls transcript offsets", () => {
    expect(
      clampTranscriptOffset({ messages, expandedIds: new Set(), offset: 99, lineLimit: 3 }),
    ).toBe(3);
    expect(
      scrollTranscriptOffset({
        messages,
        expandedIds: new Set(),
        offset: 0,
        delta: 8,
        lineLimit: 3,
      }),
    ).toBe(3);
    expect(scrollTranscriptToStartOffset({ messages, expandedIds: new Set(), lineLimit: 3 })).toBe(
      3,
    );
  });
});

describe("transcript selection navigation helpers", () => {
  it("selects messages and keeps the selection visible", () => {
    expect(
      selectTranscriptNavigation({
        messages,
        expandedIds: new Set(),
        selectedId: undefined,
        scrollOffset: 0,
        direction: -1,
        lineLimit: 3,
      }),
    ).toEqual({ selectedId: "assistant-1", scrollOffset: 1 });
  });

  it("toggles expansion without mutating the existing expanded set", () => {
    const expandedIds = new Set<string>();
    const next = toggleTranscriptExpansion({
      messages,
      expandedIds,
      selectedId: "reasoning-1",
      scrollOffset: 0,
      lineLimit: 3,
    });

    expect(expandedIds.has("reasoning-1")).toBe(false);
    expect(next.expandedIds.has("reasoning-1")).toBe(true);
    expect(next.scrollOffset).toBe(3);
  });

  it("leaves state unchanged when the selection cannot expand", () => {
    const expandedIds = new Set<string>();
    const next = toggleTranscriptExpansion({
      messages,
      expandedIds,
      selectedId: "assistant-1",
      scrollOffset: 1,
      lineLimit: 3,
    });

    expect(next.expandedIds).toBe(expandedIds);
    expect(next.scrollOffset).toBe(1);
  });
});
