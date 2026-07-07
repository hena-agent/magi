export type PromptState = {
  prompt: string;
  cursor: number;
};

export type PromptHistorySelection = {
  index: number | undefined;
  prompt: string;
};

export function setPromptText(
  nextPrompt: string,
  nextCursor: number = nextPrompt.length,
): PromptState {
  return {
    prompt: nextPrompt,
    cursor: clampPromptCursor(nextPrompt, nextCursor),
  };
}

export function clampPromptCursor(prompt: string, cursor: number): number {
  return Math.max(0, Math.min(prompt.length, cursor));
}

export function insertPromptText(state: PromptState, text: string): PromptState {
  const cursor = clampPromptCursor(state.prompt, state.cursor);
  const prompt = `${state.prompt.slice(0, cursor)}${text}${state.prompt.slice(cursor)}`;
  return setPromptText(prompt, cursor + text.length);
}

export function deletePromptCharacter(state: PromptState): PromptState {
  const cursor = clampPromptCursor(state.prompt, state.cursor);
  if (cursor <= 0) return setPromptText(state.prompt, cursor);

  const prompt = `${state.prompt.slice(0, cursor - 1)}${state.prompt.slice(cursor)}`;
  return setPromptText(prompt, cursor - 1);
}

export function deletePreviousPromptWord(state: PromptState): PromptState {
  const cursor = clampPromptCursor(state.prompt, state.cursor);
  if (cursor <= 0) return setPromptText(state.prompt, cursor);

  const beforeCursor = state.prompt.slice(0, cursor);
  const afterCursor = state.prompt.slice(cursor);
  const trimmedEnd = beforeCursor.replace(/\s+$/, "");
  const nextBeforeCursor = trimmedEnd.replace(/\S+$/, "");
  return setPromptText(`${nextBeforeCursor}${afterCursor}`, nextBeforeCursor.length);
}

export function addPromptHistoryEntry(history: string[], content: string, limit = 50): string[] {
  return [...history.filter((entry) => entry !== content), content].slice(-limit);
}

export function selectPreviousPromptHistory(
  history: string[],
  currentIndex: number | undefined,
): PromptHistorySelection | undefined {
  if (history.length === 0) return undefined;

  const index = Math.max(0, (currentIndex ?? history.length) - 1);
  return { index, prompt: history[index] ?? "" };
}

export function selectNextPromptHistory(
  history: string[],
  currentIndex: number | undefined,
): PromptHistorySelection | undefined {
  if (currentIndex === undefined) return undefined;

  const index = currentIndex + 1;
  if (index >= history.length) return { index: undefined, prompt: "" };

  return { index, prompt: history[index] ?? "" };
}
