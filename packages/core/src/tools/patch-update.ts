import type { PatchChunk } from "./patch-types.js";

export function deriveUpdatedContents(
  original: string,
  chunks: PatchChunk[],
  path: string,
): string {
  const originalHadFinalNewline = original.endsWith("\n");
  const lines = originalHadFinalNewline ? original.slice(0, -1).split("\n") : original.split("\n");
  const replacements: Array<[number, number, string[]]> = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    lineIndex = collectReplacement(lines, chunk, path, lineIndex, replacements);
  }

  const next = [...lines];

  for (const [start, deleteCount, newLines] of replacements.toSorted((a, b) => b[0] - a[0])) {
    next.splice(start, deleteCount, ...newLines);
  }

  return ensureTrailingNewline(next.join("\n"));
}

function collectReplacement(
  lines: string[],
  chunk: PatchChunk,
  path: string,
  lineIndex: number,
  replacements: Array<[number, number, string[]]>,
): number {
  const startIndex = seekContext(lines, chunk, path, lineIndex);

  if (chunk.oldLines.length === 0) {
    const insertionIndex = chunk.isEndOfFile ? lines.length : startIndex;
    replacements.push([insertionIndex, 0, chunk.newLines]);
    return insertionIndex + chunk.newLines.length;
  }

  const found = seekSequence(lines, chunk.oldLines, startIndex, chunk.isEndOfFile);

  if (found === -1) {
    throw new Error(
      `apply_patch verification failed: failed to find expected lines in ${path}:\n${chunk.oldLines.join("\n")}`,
    );
  }

  replacements.push([found, chunk.oldLines.length, chunk.newLines]);
  return found + chunk.oldLines.length;
}

function seekContext(lines: string[], chunk: PatchChunk, path: string, lineIndex: number): number {
  if (!chunk.changeContext) {
    return lineIndex;
  }

  const contextIndex = seekSequence(lines, [chunk.changeContext], lineIndex);

  if (contextIndex === -1) {
    throw new Error(
      `apply_patch verification failed: failed to find context '${chunk.changeContext}' in ${path}`,
    );
  }

  return contextIndex + 1;
}

function seekSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  endOfFile = false,
): number {
  if (pattern.length === 0) {
    return -1;
  }

  const comparators = [
    (a: string, b: string) => a === b,
    (a: string, b: string) => a.trimEnd() === b.trimEnd(),
    (a: string, b: string) => a.trim() === b.trim(),
    (a: string, b: string) => normalizeUnicode(a.trim()) === normalizeUnicode(b.trim()),
  ];

  for (const compare of comparators) {
    const found = tryMatch(lines, pattern, startIndex, compare, endOfFile);

    if (found !== -1) {
      return found;
    }
  }

  return -1;
}

function tryMatch(
  lines: string[],
  pattern: string[],
  startIndex: number,
  compare: (a: string, b: string) => boolean,
  endOfFile: boolean,
): number {
  if (endOfFile) {
    const fromEnd = lines.length - pattern.length;

    if (fromEnd >= startIndex && matchesSequence(lines, pattern, fromEnd, compare)) {
      return fromEnd;
    }
  }

  for (let index = startIndex; index <= lines.length - pattern.length; index += 1) {
    if (matchesSequence(lines, pattern, index, compare)) {
      return index;
    }
  }

  return -1;
}

function matchesSequence(
  lines: string[],
  pattern: string[],
  startIndex: number,
  compare: (a: string, b: string) => boolean,
): boolean {
  return pattern.every((line, offset) => {
    const candidate = lines[startIndex + offset];
    return candidate !== undefined && compare(candidate, line);
  });
}

function normalizeUnicode(value: string): string {
  return value
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

function ensureTrailingNewline(value: string): string {
  return value.length === 0 || value.endsWith("\n") ? value : `${value}\n`;
}
