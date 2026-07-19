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

export type ComposerViewport = {
  cursor: number;
  hiddenAbove: number;
  hiddenBelow: number;
  prompt: string;
};

type ComposerRow = { start: number; end: number; text: string };

export function getComposerViewport(input: {
  prompt: string;
  cursor: number;
  columns: number;
  maxLines: number;
}): ComposerViewport {
  if (input.prompt.length === 0) {
    return { prompt: "", cursor: 0, hiddenAbove: 0, hiddenBelow: 0 };
  }

  const rows = wrapComposerRows(input.prompt, Math.max(1, input.columns));
  const cursor = Math.max(0, Math.min(input.prompt.length, input.cursor));
  const matchedCursorRowIndex = rows.findIndex((row, index) => {
    const next = rows[index + 1];
    return cursor >= row.start && (next ? cursor < next.start : cursor <= row.end);
  });
  const cursorRowIndex = matchedCursorRowIndex === -1 ? rows.length - 1 : matchedCursorRowIndex;
  const maxLines = Math.max(1, input.maxLines);
  const start = Math.max(
    0,
    Math.min(cursorRowIndex - Math.floor(maxLines / 2), rows.length - maxLines),
  );
  const visibleRows = rows.slice(start, start + maxLines);
  const localCursor = visibleRows.reduce((offset, row, index) => {
    if (index < cursorRowIndex - start) return offset + row.text.length + 1;
    if (index === cursorRowIndex - start) return offset + Math.max(0, cursor - row.start);
    return offset;
  }, 0);

  return {
    prompt: visibleRows.map((row) => row.text).join("\n"),
    cursor: localCursor,
    hiddenAbove: start,
    hiddenBelow: Math.max(0, rows.length - start - visibleRows.length),
  };
}

function wrapComposerRows(prompt: string, columns: number): ComposerRow[] {
  const rows: ComposerRow[] = [];
  let sourceOffset = 0;

  for (const line of prompt.split("\n")) {
    if (line.length === 0) rows.push({ start: sourceOffset, end: sourceOffset, text: "" });
    for (let offset = 0; offset < line.length; offset += columns) {
      const text = line.slice(offset, offset + columns);
      rows.push({ start: sourceOffset + offset, end: sourceOffset + offset + text.length, text });
    }
    sourceOffset += line.length + 1;
  }

  return rows;
}

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
  const cursorChar = prompt[safeCursor] === "\n" ? " " : (prompt[safeCursor] ?? " ");
  const afterStart =
    prompt[safeCursor] === "\n" ? safeCursor : safeCursor + (prompt[safeCursor] ? 1 : 0);

  return {
    after: prompt.slice(afterStart),
    before: prompt.slice(0, safeCursor),
    cursor: cursorChar,
    isPlaceholder: false,
  };
}
