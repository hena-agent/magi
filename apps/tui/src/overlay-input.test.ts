import { describe, expect, it } from "vitest";
import type { QuestionPrompt } from "./app-controller.js";
import {
  readPermissionInputAction,
  readQuestionInputAction,
  readSelectorInputAction,
} from "./overlay-input.js";
import type { TuiKeyEvent } from "./tui-key-event.js";

const baseEvent: TuiKeyEvent = {
  ctrl: false,
  input: "",
  meta: false,
  name: "",
  shift: false,
  super: false,
};

function event(input: Partial<TuiKeyEvent>): TuiKeyEvent {
  return { ...baseEvent, ...input };
}

const singleQuestion: QuestionPrompt = {
  header: "Decision",
  multiple: false,
  options: [
    { label: "Yes", description: "Approve" },
    { label: "No", description: "Reject" },
  ],
  question: "Proceed?",
};

const multiQuestion: QuestionPrompt = { ...singleQuestion, multiple: true };

describe("readPermissionInputAction", () => {
  it("resolves allow, deny, cancel, and none", () => {
    expect(readPermissionInputAction(event({ input: "y", name: "y" }))).toEqual({
      type: "resolve",
      allow: true,
    });
    expect(readPermissionInputAction(event({ input: "n", name: "n" }))).toEqual({
      type: "resolve",
      allow: false,
    });
    expect(readPermissionInputAction(event({ name: "escape" }))).toEqual({
      type: "resolve",
      allow: false,
    });
    expect(readPermissionInputAction(event({ input: "x", name: "x" }))).toEqual({ type: "none" });
  });
});

describe("readSelectorInputAction", () => {
  it("moves with wrapping and selects or cancels", () => {
    expect(
      readSelectorInputAction({ event: event({ name: "up" }), selectedIndex: 0, itemCount: 3 }),
    ).toEqual({ type: "move", selectedIndex: 2 });
    expect(
      readSelectorInputAction({ event: event({ name: "down" }), selectedIndex: 2, itemCount: 3 }),
    ).toEqual({ type: "move", selectedIndex: 0 });
    expect(
      readSelectorInputAction({ event: event({ name: "return" }), selectedIndex: 1, itemCount: 3 }),
    ).toEqual({ type: "select", selectedIndex: 1 });
    expect(
      readSelectorInputAction({ event: event({ name: "escape" }), selectedIndex: 1, itemCount: 3 }),
    ).toEqual({ type: "cancel" });
  });
});

describe("readQuestionInputAction navigation", () => {
  it("moves options with wrapping", () => {
    expect(
      readQuestionInputAction({
        activeQuestion: singleQuestion,
        answer: "",
        event: event({ name: "up" }),
        optionIndex: 0,
        selectedOptionIndexes: new Set(),
      }),
    ).toEqual({ type: "move", optionIndex: 1 });
  });
});

describe("readQuestionInputAction selection", () => {
  it("selects single options and toggles multiple options", () => {
    const single = readQuestionInputAction({
      activeQuestion: singleQuestion,
      answer: "typed",
      event: event({ input: " ", name: "space" }),
      optionIndex: 1,
      selectedOptionIndexes: new Set([0]),
    });
    expect(single).toEqual({
      type: "set-selection",
      selectedOptionIndexes: new Set([1]),
      answer: "",
    });

    const multi = readQuestionInputAction({
      activeQuestion: multiQuestion,
      answer: "",
      event: event({ input: " ", name: "space" }),
      optionIndex: 1,
      selectedOptionIndexes: new Set([0, 1]),
    });
    expect(multi).toEqual({
      type: "set-selection",
      selectedOptionIndexes: new Set([0]),
      answer: "",
    });
  });
});

describe("readQuestionInputAction answer editing", () => {
  it("submits, cancels, edits answer, and appends printable input", () => {
    expect(
      readQuestionInputAction({
        activeQuestion: singleQuestion,
        answer: "abc",
        event: event({ name: "backspace" }),
        optionIndex: 0,
        selectedOptionIndexes: new Set([0]),
      }),
    ).toEqual({ type: "set-answer", answer: "ab", selectedOptionIndexes: new Set() });
    expect(
      readQuestionInputAction({
        activeQuestion: singleQuestion,
        answer: "ab",
        event: event({ input: "c", name: "c" }),
        optionIndex: 0,
        selectedOptionIndexes: new Set([0]),
      }),
    ).toEqual({ type: "set-answer", answer: "abc", selectedOptionIndexes: new Set() });
    expect(
      readQuestionInputAction({
        activeQuestion: singleQuestion,
        answer: "",
        event: event({ name: "return" }),
        optionIndex: 0,
        selectedOptionIndexes: new Set(),
      }),
    ).toEqual({ type: "submit" });
    expect(
      readQuestionInputAction({
        activeQuestion: singleQuestion,
        answer: "",
        event: event({ name: "escape" }),
        optionIndex: 0,
        selectedOptionIndexes: new Set(),
      }),
    ).toEqual({ type: "cancel" });
  });
});
