import { describe, expect, it } from "vitest";
import type { TranscriptMessage, TranscriptPart } from "./app-controller.js";
import {
  findMatchingToolPartId,
  findToolInput,
  isSameToolPart,
  mergeTranscriptPart,
  stableStringify,
  toolInputsEqual,
  upsertTranscriptPart,
} from "./transcript-parts.js";

const toolPart: Extract<TranscriptPart, { type: "tool" }> = {
  id: "tool:call-1",
  type: "tool",
  tool: "bash",
  state: {
    status: "running",
    input: { command: "pnpm test" },
    metadata: { target: "pnpm test" },
    time: { start: 1_000 },
  },
};

describe("transcript part helpers", () => {
  it("merges tool part state without losing original start time or metadata", () => {
    expect(
      mergeTranscriptPart(toolPart, {
        ...toolPart,
        state: {
          status: "completed",
          input: { command: "pnpm test" },
          output: "ok",
          metadata: { summary: "passed" },
          time: { start: 2_000, end: 3_000 },
        },
      }),
    ).toEqual({
      ...toolPart,
      state: {
        status: "completed",
        input: { command: "pnpm test" },
        output: "ok",
        metadata: { target: "pnpm test", summary: "passed" },
        time: { start: 1_000, end: 3_000 },
      },
    });
  });

  it("merges reasoning part end time while preserving start time", () => {
    expect(
      mergeTranscriptPart(
        { id: "reasoning:1", type: "reasoning", text: "start", time: { start: 1_000 } },
        {
          id: "reasoning:1",
          type: "reasoning",
          text: "start done",
          time: { start: 2_000, end: 3_000 },
        },
      ),
    ).toEqual({
      id: "reasoning:1",
      type: "reasoning",
      text: "start done",
      time: { start: 1_000, end: 3_000 },
    });
  });

  it("upserts transcript parts by id", () => {
    const message: TranscriptMessage = { id: "assistant-1", role: "assistant", parts: [toolPart] };

    expect(
      upsertTranscriptPart(message, { id: "status-1", type: "status", text: "done" }).parts,
    ).toHaveLength(2);
    expect(
      upsertTranscriptPart(message, {
        ...toolPart,
        state: { ...toolPart.state, status: "completed", time: { start: 1_000, end: 2_000 } },
      }).parts[0],
    ).toMatchObject({ state: { status: "completed", time: { start: 1_000, end: 2_000 } } });
  });

  it("finds tool input and matching part ids", () => {
    const message: TranscriptMessage = { id: "assistant-1", role: "assistant", parts: [toolPart] };

    expect(findToolInput([message], "call-1")).toEqual({ command: "pnpm test" });
    expect(findMatchingToolPartId(message, "bash", { command: "pnpm test" })).toBe("tool:call-1");
    expect(findMatchingToolPartId(message, "bash", { command: "pnpm build" }, "call-2")).toBe(
      "tool:call-2",
    );
  });

  it("compares stable tool inputs", () => {
    expect(stableStringify({ b: 1, a: [2, 3] })).toBe('{"a":[2,3],"b":1}');
    expect(toolInputsEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(isSameToolPart(toolPart, { id: "call-1", name: "bash", input: {} })).toBe(true);
    expect(
      isSameToolPart(toolPart, {
        id: "other",
        name: "bash",
        input: { command: "pnpm test" },
      }),
    ).toBe(true);
  });
});
