export function formatComposerPromptDisplay(prompt: string, placeholder = ""): string {
  if (prompt.length === 0 && placeholder.length > 0) return placeholder;

  return prompt;
}

export type ComposerCursorDisplay = {
  before: string;
  cursor: string;
  after: string;
  isPlaceholder: boolean;
};

export function formatComposerCursorDisplay(
  prompt: string,
  cursor: number,
  placeholder = "",
): ComposerCursorDisplay {
  if (prompt.length === 0 && placeholder.length > 0) {
    return {
      after: placeholder.slice(1),
      before: "",
      cursor: placeholder[0] ?? " ",
      isPlaceholder: true,
    };
  }

  const safeCursor = Math.max(0, Math.min(prompt.length, cursor));
  const cursorChar = prompt[safeCursor] ?? " ";

  return {
    after: prompt.slice(safeCursor + (prompt[safeCursor] ? 1 : 0)),
    before: prompt.slice(0, safeCursor),
    cursor: cursorChar,
    isPlaceholder: false,
  };
}
