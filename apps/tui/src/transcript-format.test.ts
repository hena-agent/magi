import { describe, expect, it } from "vitest";
import type { TranscriptMessage } from "./app-controller.js";
import { formatTranscriptMessageLines } from "./transcript-format.js";

describe("formatTranscriptMessageLines", () => {
  it("formats user messages", () => {
    const message: TranscriptMessage = {
      id: "user-1",
      role: "user",
      parts: [{ id: "user-1:text", type: "text", text: "Fix this" }],
    };

    expect(
      formatTranscriptMessageLines({
        expandedIds: new Set(),
        first: true,
        message,
        selectedId: undefined,
      }).map((line) => line.text),
    ).toEqual(["  │ You", "  │ Fix this"]);
  });

  it("formats assistant text and completion metadata", () => {
    const message: TranscriptMessage = {
      agentId: "build",
      completedAt: 2_500,
      createdAt: 1_000,
      id: "assistant-1",
      model: "gpt-test",
      role: "assistant",
      parts: [{ id: "assistant-1:text", type: "text", text: "Done" }],
    };

    expect(
      formatTranscriptMessageLines({
        expandedIds: new Set(),
        first: true,
        message,
        selectedId: undefined,
      }).map((line) => line.text),
    ).toEqual(["  Done", "  ▣ build · gpt-test · 1.5s"]);
  });

  it("formats collapsed and expanded reasoning parts", () => {
    const message: TranscriptMessage = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        {
          id: "reasoning-1",
          type: "reasoning",
          text: "Check the repo\nthen edit",
          time: { end: 1_500, start: 1_000 },
        },
      ],
    };

    expect(
      formatTranscriptMessageLines({
        expandedIds: new Set(),
        first: true,
        message,
        selectedId: undefined,
      }).map((line) => line.text),
    ).toEqual(["  + Thought: Check the repo · 500ms", "  ▣ assistant"]);

    expect(
      formatTranscriptMessageLines({
        expandedIds: new Set(["reasoning-1"]),
        first: true,
        message,
        selectedId: undefined,
      }).map((line) => line.text),
    ).toEqual([
      "  - Thought: Check the repo · 500ms",
      "  Check the repo",
      "  then edit",
      "  ▣ assistant",
    ]);
  });

  it("formats tool summaries and expanded details", () => {
    const message: TranscriptMessage = {
      id: "assistant-3",
      role: "assistant",
      parts: [
        {
          id: "tool-1",
          type: "tool",
          tool: "bash",
          state: {
            input: { command: "pnpm test" },
            metadata: { durationMs: 1_200, summary: "passed" },
            output: "ok",
            status: "completed",
            time: { end: 2_200, start: 1_000 },
            title: "completed",
          },
        },
      ],
    };

    expect(
      formatTranscriptMessageLines({
        expandedIds: new Set(["tool-1"]),
        first: true,
        message,
        selectedId: undefined,
      }).map((line) => line.text),
    ).toEqual([
      "  $ bash completed pnpm test [-]",
      "  passed",
      "  duration 1.2s",
      "  Input:",
      "  {",
      '    "command": "pnpm test"',
      "  }",
      "  Output:",
      "  ok",
      "  ▣ assistant",
    ]);
  });
});
