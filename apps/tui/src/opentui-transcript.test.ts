import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "./app-controller.js";
import {
  createOpenTuiUserPromptMessage,
  readOpenTuiTranscriptLineColor,
} from "./opentui-transcript-format.js";
import { getTranscriptVisibleLineWindow } from "./transcript-state.js";

describe("createOpenTuiUserPromptMessage", () => {
  it("wraps submitted prompts in transcript user messages", () => {
    expect(createOpenTuiUserPromptMessage("Fix this", "prompt-1")).toEqual({
      id: "prompt-1",
      role: "user",
      parts: [{ id: "prompt-1:text", text: "Fix this", type: "text" }],
    });
  });
});

describe("readOpenTuiTranscriptLineColor", () => {
  const colors = { mutedColor: "#94a3b8", textColor: "#111827" };

  it("maps semantic transcript colors", () => {
    expect(readOpenTuiTranscriptLineColor({ color: "red" }, colors)).toBe("#dc2626");
    expect(readOpenTuiTranscriptLineColor({ color: "yellow" }, colors)).toBe("#d97706");
  });

  it("uses muted color for dim unselected lines", () => {
    expect(readOpenTuiTranscriptLineColor({ dim: true, selected: false }, colors)).toBe("#94a3b8");
  });

  it("keeps selected and normal lines readable", () => {
    expect(readOpenTuiTranscriptLineColor({ dim: true, selected: true }, colors)).toBe("#111827");
    expect(readOpenTuiTranscriptLineColor({}, colors)).toBe("#111827");
  });
});

describe("OpenTUI transcript shared state", () => {
  it("marks selected and expanded transcript lines for OpenTUI rendering", () => {
    const messages: TranscriptMessage[] = [
      createOpenTuiUserPromptMessage("Fix this", "prompt-1"),
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            id: "reasoning-1",
            type: "reasoning",
            text: "Read files\nPatch code",
            time: { start: 1_000, end: 1_250 },
          },
        ],
      },
    ];

    const window = getTranscriptVisibleLineWindow({
      messages,
      selectedId: "reasoning-1",
      expandedIds: new Set(["reasoning-1"]),
      scrollOffset: 0,
      lineLimit: 10,
    });

    expect(window.visibleLines.map((line) => line.text)).toEqual([
      "  │ You",
      "  │ Fix this",
      "",
      "› - Thought: Read files · 250ms",
      "  Read files",
      "  Patch code",
      "  ▣ assistant",
    ]);
    expect(window.visibleLines.filter((line) => line.selected).map((line) => line.text)).toEqual([
      "› - Thought: Read files · 250ms",
      "  Read files",
      "  Patch code",
    ]);
  });
});
