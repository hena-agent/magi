import { describe, expect, it } from "vitest";
import { formatPermissionDescriptionLines, getQuestionMode } from "./overlays.js";

describe("formatPermissionDescriptionLines", () => {
  it("splits tool permission descriptions", () => {
    expect(formatPermissionDescriptionLines("bash: pnpm test")).toEqual([
      { label: "tool", text: "Tool: bash", muted: false },
      { label: "input", text: "Input: pnpm test", muted: true },
    ]);
  });

  it("keeps descriptions without tool input separators intact", () => {
    expect(formatPermissionDescriptionLines("Allow operation")).toEqual([
      { label: "description", text: "Allow operation", muted: false },
    ]);
  });
});

describe("getQuestionMode", () => {
  const activeQuestion = {
    options: [{ label: "Yes" }, { label: "No" }, { label: "Later" }],
  };

  it("prefers custom answers", () => {
    expect(
      getQuestionMode({
        activeQuestion,
        answer: "custom",
        optionIndex: 0,
        selectedOptionIndexes: new Set([1]),
      }),
    ).toBe("custom answer: custom");
  });

  it("summarizes selected options", () => {
    expect(
      getQuestionMode({
        activeQuestion,
        answer: "",
        optionIndex: 0,
        selectedOptionIndexes: new Set([2, 0]),
      }),
    ).toBe("selected: Yes, Later");
  });

  it("shows the ready option or text-entry fallback", () => {
    expect(
      getQuestionMode({
        activeQuestion,
        answer: "",
        optionIndex: 1,
        selectedOptionIndexes: new Set(),
      }),
    ).toBe("ready: No");
    expect(
      getQuestionMode({
        activeQuestion: undefined,
        answer: "",
        optionIndex: 0,
        selectedOptionIndexes: new Set(),
      }),
    ).toBe("type an answer");
  });
});
