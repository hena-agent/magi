import type { QuestionPrompt } from "./app-controller.js";
import type { TuiKeyEvent } from "./tui-key-event.js";

export type PermissionInputAction = { type: "resolve"; allow: boolean } | { type: "none" };

export type SelectorInputAction =
  | { type: "cancel" }
  | { type: "move"; selectedIndex: number }
  | { type: "select"; selectedIndex: number }
  | { type: "none" };

export type QuestionInputAction =
  | { type: "cancel" }
  | { type: "move"; optionIndex: number }
  | { type: "set-selection"; selectedOptionIndexes: Set<number>; answer: string }
  | { type: "submit" }
  | { type: "set-answer"; answer: string; selectedOptionIndexes: Set<number> }
  | { type: "none" };

export function readPermissionInputAction(event: TuiKeyEvent): PermissionInputAction {
  if (event.input.toLowerCase() === "y") return { type: "resolve", allow: true };
  if (event.input.toLowerCase() === "n" || event.name === "escape") {
    return { type: "resolve", allow: false };
  }

  return { type: "none" };
}

export function readSelectorInputAction(input: {
  event: TuiKeyEvent;
  selectedIndex: number;
  itemCount: number;
}): SelectorInputAction {
  if (input.event.name === "escape") return { type: "cancel" };
  if (input.itemCount <= 0) return { type: "none" };

  if (input.event.name === "up") {
    return {
      type: "move",
      selectedIndex: input.selectedIndex <= 0 ? input.itemCount - 1 : input.selectedIndex - 1,
    };
  }

  if (input.event.name === "down") {
    return { type: "move", selectedIndex: (input.selectedIndex + 1) % input.itemCount };
  }

  if (input.event.name === "return") {
    return { type: "select", selectedIndex: input.selectedIndex };
  }

  return { type: "none" };
}

export function readQuestionInputAction(input: {
  event: TuiKeyEvent;
  activeQuestion: QuestionPrompt | undefined;
  optionIndex: number;
  selectedOptionIndexes: Set<number>;
  answer: string;
}): QuestionInputAction {
  const optionCount = input.activeQuestion?.options.length ?? 0;

  if (input.event.name === "escape") return { type: "cancel" };

  if (optionCount > 0 && input.event.name === "up") {
    return {
      type: "move",
      optionIndex: input.optionIndex <= 0 ? optionCount - 1 : input.optionIndex - 1,
    };
  }

  if (optionCount > 0 && input.event.name === "down") {
    return { type: "move", optionIndex: (input.optionIndex + 1) % optionCount };
  }

  if (optionCount > 0 && input.event.input === " ") {
    return {
      type: "set-selection",
      selectedOptionIndexes: selectQuestionOption({
        activeQuestion: input.activeQuestion,
        optionIndex: input.optionIndex,
        selectedOptionIndexes: input.selectedOptionIndexes,
      }),
      answer: "",
    };
  }

  if (input.event.name === "return") return { type: "submit" };

  if (input.event.name === "backspace" || input.event.name === "delete") {
    return {
      type: "set-answer",
      answer: input.answer.slice(0, -1),
      selectedOptionIndexes: new Set(),
    };
  }

  if (input.event.input.length > 0) {
    return {
      type: "set-answer",
      answer: input.answer + input.event.input,
      selectedOptionIndexes: new Set(),
    };
  }

  return { type: "none" };
}

function selectQuestionOption(input: {
  activeQuestion: QuestionPrompt | undefined;
  optionIndex: number;
  selectedOptionIndexes: Set<number>;
}): Set<number> {
  if (input.activeQuestion?.multiple) {
    const next = new Set(input.selectedOptionIndexes);
    if (next.has(input.optionIndex)) {
      next.delete(input.optionIndex);
    } else {
      next.add(input.optionIndex);
    }
    return next;
  }

  return new Set([input.optionIndex]);
}
