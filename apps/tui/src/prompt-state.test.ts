import { describe, expect, it } from "vitest";
import {
  addPromptHistoryEntry,
  clampPromptCursor,
  deletePreviousPromptWord,
  deletePromptCharacter,
  insertPromptText,
  selectNextPromptHistory,
  selectPreviousPromptHistory,
  setPromptText,
} from "./prompt-state.js";

describe("prompt state helpers", () => {
  it("clamps cursor positions", () => {
    expect(clampPromptCursor("abc", -1)).toBe(0);
    expect(clampPromptCursor("abc", 2)).toBe(2);
    expect(clampPromptCursor("abc", 9)).toBe(3);
    expect(setPromptText("abc", 9)).toEqual({ prompt: "abc", cursor: 3 });
  });

  it("inserts text at the cursor", () => {
    expect(insertPromptText({ prompt: "ac", cursor: 1 }, "b")).toEqual({
      prompt: "abc",
      cursor: 2,
    });
  });

  it("deletes one character before the cursor", () => {
    expect(deletePromptCharacter({ prompt: "abc", cursor: 2 })).toEqual({
      prompt: "ac",
      cursor: 1,
    });
    expect(deletePromptCharacter({ prompt: "abc", cursor: 0 })).toEqual({
      prompt: "abc",
      cursor: 0,
    });
  });

  it("deletes the previous word while preserving text after the cursor", () => {
    expect(deletePreviousPromptWord({ prompt: "run   tests now", cursor: 11 })).toEqual({
      prompt: "run    now",
      cursor: 6,
    });
    expect(deletePreviousPromptWord({ prompt: "run tests   ", cursor: 12 })).toEqual({
      prompt: "run ",
      cursor: 4,
    });
  });
});

describe("prompt history helpers", () => {
  it("deduplicates entries and keeps newest content at the end", () => {
    expect(addPromptHistoryEntry(["a", "b", "a"], "b")).toEqual(["a", "a", "b"]);
    expect(addPromptHistoryEntry(["a", "b", "c"], "d", 2)).toEqual(["c", "d"]);
  });

  it("selects previous and next history entries", () => {
    const history = ["first", "second"];

    expect(selectPreviousPromptHistory(history, undefined)).toEqual({
      index: 1,
      prompt: "second",
    });
    expect(selectPreviousPromptHistory(history, 1)).toEqual({ index: 0, prompt: "first" });
    expect(selectNextPromptHistory(history, 0)).toEqual({ index: 1, prompt: "second" });
    expect(selectNextPromptHistory(history, 1)).toEqual({ index: undefined, prompt: "" });
    expect(selectNextPromptHistory(history, undefined)).toBeUndefined();
  });
});
