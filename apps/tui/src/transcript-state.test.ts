import { describe, expect, it } from "vitest";
import {
  clampTranscriptScrollOffset,
  getSelectableTranscriptIds,
  getTranscriptLineCount,
  getTranscriptMaxScrollOffset,
  getTranscriptMessageLineCount,
  getTranscriptMessageLineRange,
  getTranscriptVisibleLineWindow,
  isExpandableTranscriptId,
  keepTranscriptMessageOffsetVisible,
  selectTranscriptId,
} from "./transcript-state.js";
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
      {
        id: "tool-1",
        type: "tool",
        tool: "bash",
        state: {
          input: { command: "pnpm test" },
          output: "ok",
          status: "completed",
          time: { start: 1_200, end: 1_500 },
        },
      },
      { id: "assistant-1:text", type: "text", text: "Done" },
    ],
  },
];
const firstMessage = messages[0];
if (!firstMessage) throw new Error("Expected transcript fixture to contain a message.");

describe("transcript line state", () => {
  it("counts and windows formatted transcript lines", () => {
    expect(getTranscriptLineCount(messages, new Set())).toBe(7);
    expect(
      getTranscriptMessageLineCount({ message: firstMessage, expandedIds: new Set(), first: true }),
    ).toBe(2);
    expect(getTranscriptMessageLineCount({ message: firstMessage, expandedIds: new Set() })).toBe(
      3,
    );

    expect(
      getTranscriptVisibleLineWindow({
        messages,
        selectedId: undefined,
        expandedIds: new Set(),
        scrollOffset: 1,
        lineLimit: 3,
      }).visibleLines.map((line) => line.text),
    ).toEqual(["  + Thought: Check repo · 200ms", "  $ bash completed pnpm test [+]", "  Done"]);
  });

  it("finds message and part line ranges", () => {
    expect(
      getTranscriptMessageLineRange({
        messages,
        expandedIds: new Set(),
        messageId: "assistant-1",
      }),
    ).toEqual({ start: 2, end: 7 });

    expect(
      getTranscriptMessageLineRange({
        messages,
        expandedIds: new Set(["reasoning-1"]),
        messageId: "reasoning-1",
      }),
    ).toEqual({ start: 2, end: 9 });
  });
});

describe("transcript navigation state", () => {
  it("selects selectable transcript ids", () => {
    expect(getSelectableTranscriptIds(messages)).toEqual([
      "user-1",
      "assistant-1",
      "reasoning-1",
      "tool-1",
    ]);
    expect(isExpandableTranscriptId(messages, "reasoning-1")).toBe(true);
    expect(isExpandableTranscriptId(messages, "assistant-1")).toBe(false);
    expect(selectTranscriptId({ messages, selectedId: undefined, direction: -1 })).toBe(
      "reasoning-1",
    );
  });

  it("clamps and keeps selected ranges visible", () => {
    expect(getTranscriptMaxScrollOffset({ messages, expandedIds: new Set(), lineLimit: 3 })).toBe(
      4,
    );
    expect(
      clampTranscriptScrollOffset({
        messages,
        expandedIds: new Set(),
        offset: 99,
        lineLimit: 3,
      }),
    ).toBe(4);
    expect(
      keepTranscriptMessageOffsetVisible({
        messages,
        expandedIds: new Set(),
        messageId: "user-1",
        offset: 0,
        lineLimit: 3,
      }),
    ).toBe(4);
  });
});
