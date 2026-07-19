import { describe, expect, it } from "vitest";
import {
  formatComposerCursorDisplay,
  formatComposerPromptDisplay,
  getComposerViewport,
} from "./composer-format.js";

describe("formatComposerPromptDisplay", () => {
  it("shows prompt text without inline cursor markers", () => {
    expect(formatComposerPromptDisplay("abc")).toBe("abc");
  });

  it("shows placeholder text for empty prompts", () => {
    expect(formatComposerPromptDisplay("", "Ask anything...")).toBe("Ask anything...");
  });
});

describe("formatComposerCursorDisplay", () => {
  it("splits prompt text around the cursor", () => {
    expect(formatComposerCursorDisplay("abc", 1)).toEqual({
      after: "c",
      before: "a",
      cursor: "b",
      isPlaceholder: false,
    });
  });

  it("uses a blank cursor cell at the end of prompt text", () => {
    expect(formatComposerCursorDisplay("abc", 3)).toEqual({
      after: "",
      before: "abc",
      cursor: " ",
      isPlaceholder: false,
    });
  });

  it("keeps newline characters visible when the cursor is on a line break", () => {
    expect(formatComposerCursorDisplay("first\nsecond", 5)).toEqual({
      after: "\nsecond",
      before: "first",
      cursor: " ",
      isPlaceholder: false,
    });
  });

  it("splits multiline prompt text around a cursor after a line break", () => {
    expect(formatComposerCursorDisplay("first\nsecond", 7)).toEqual({
      after: "cond",
      before: "first\ns",
      cursor: "e",
      isPlaceholder: false,
    });
  });

  it("places the cursor over the first placeholder character", () => {
    expect(formatComposerCursorDisplay("", 0, "Ask anything...")).toEqual({
      after: "sk anything...",
      before: "",
      cursor: "A",
      isPlaceholder: true,
    });
  });
});

describe("getComposerViewport", () => {
  it("keeps the cursor row visible while limiting multiline prompts", () => {
    expect(
      getComposerViewport({
        prompt: "one\ntwo\nthree\nfour",
        cursor: 14,
        columns: 20,
        maxLines: 2,
      }),
    ).toEqual({
      prompt: "three\nfour",
      cursor: 6,
      hiddenAbove: 2,
      hiddenBelow: 0,
    });
  });

  it("wraps long logical lines to terminal columns", () => {
    expect(
      getComposerViewport({ prompt: "abcdefghij", cursor: 8, columns: 4, maxLines: 2 }),
    ).toEqual({ prompt: "efgh\nij", cursor: 5, hiddenAbove: 1, hiddenBelow: 0 });
  });

  it("keeps a cursor on a newline at the end of the preceding row", () => {
    expect(
      getComposerViewport({ prompt: "one\ntwo", cursor: 3, columns: 20, maxLines: 2 }),
    ).toEqual({ prompt: "one\ntwo", cursor: 3, hiddenAbove: 0, hiddenBelow: 0 });
  });
});
