import type { PatchChunk, PatchHunk } from "./patch-types.js";

type ParseResult = {
  hunk: PatchHunk;
  nextIndex: number;
};

export function parseMagiPatch(patchText: string): PatchHunk[] {
  const lines = stripHeredoc(patchText.trim())
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split("\n");
  const beginIndex = lines.findIndex((line) => line.trim() === "*** Begin Patch");
  const endIndex = lines.findIndex((line) => line.trim() === "*** End Patch");

  if (beginIndex === -1 || endIndex === -1 || beginIndex >= endIndex) {
    throw new Error("apply_patch verification failed: invalid patch format");
  }

  const hunks: PatchHunk[] = [];
  let index = beginIndex + 1;

  while (index < endIndex) {
    const result = parseHunk(lines, index, endIndex);

    if (!result) {
      index += 1;
      continue;
    }

    hunks.push(result.hunk);
    index = result.nextIndex;
  }

  return hunks;
}

function parseHunk(lines: string[], index: number, endIndex: number): ParseResult | undefined {
  const line = lines[index] ?? "";

  if (line.startsWith("*** Add File:")) {
    return parseAddHunk(lines, index, endIndex);
  }

  if (line.startsWith("*** Delete File:")) {
    return {
      hunk: { type: "delete", path: line.slice("*** Delete File:".length).trim() },
      nextIndex: index + 1,
    };
  }

  if (line.startsWith("*** Update File:")) {
    return parseUpdateHunk(lines, index, endIndex);
  }

  return undefined;
}

function parseAddHunk(lines: string[], index: number, endIndex: number): ParseResult {
  const path = (lines[index] ?? "").slice("*** Add File:".length).trim();
  const contents: string[] = [];
  let nextIndex = index + 1;

  while (nextIndex < endIndex && !(lines[nextIndex] ?? "").startsWith("***")) {
    const contentLine = lines[nextIndex] ?? "";

    if (contentLine.startsWith("+")) {
      contents.push(contentLine.slice(1));
    }

    nextIndex += 1;
  }

  return { hunk: { type: "add", path, contents: contents.join("\n") }, nextIndex };
}

function parseUpdateHunk(lines: string[], index: number, endIndex: number): ParseResult {
  const path = (lines[index] ?? "").slice("*** Update File:".length).trim();
  const move = readOptionalMove(lines, index + 1);
  const chunks: PatchChunk[] = [];
  let nextIndex = move.nextIndex;

  while (nextIndex < endIndex && !(lines[nextIndex] ?? "").startsWith("***")) {
    const result = parseChunk(lines, nextIndex, endIndex);

    if (!result) {
      nextIndex += 1;
      continue;
    }

    chunks.push(result.chunk);
    nextIndex = result.nextIndex;
  }

  return { hunk: { type: "update", path, movePath: move.movePath, chunks }, nextIndex };
}

function readOptionalMove(
  lines: string[],
  index: number,
): { movePath?: string; nextIndex: number } {
  const moveLine = lines[index];

  if (!moveLine?.startsWith("*** Move to:")) {
    return { nextIndex: index };
  }

  return { movePath: moveLine.slice("*** Move to:".length).trim(), nextIndex: index + 1 };
}

function parseChunk(
  lines: string[],
  index: number,
  endIndex: number,
): { chunk: PatchChunk; nextIndex: number } | undefined {
  const chunkHeader = lines[index] ?? "";

  if (!chunkHeader.startsWith("@@")) {
    return undefined;
  }

  const changeContext = chunkHeader.slice(2).trim() || undefined;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  let isEndOfFile = false;
  let nextIndex = index + 1;

  while (isPatchChangeLine(lines, nextIndex, endIndex)) {
    const changeLine = lines[nextIndex] ?? "";

    if (changeLine === "*** End of File") {
      isEndOfFile = true;
      nextIndex += 1;
      break;
    }

    appendChangeLine(changeLine, oldLines, newLines);
    nextIndex += 1;
  }

  return { chunk: { oldLines, newLines, changeContext, isEndOfFile }, nextIndex };
}

function isPatchChangeLine(lines: string[], index: number, endIndex: number): boolean {
  return (
    index < endIndex &&
    !(lines[index] ?? "").startsWith("@@") &&
    !(lines[index] ?? "").startsWith("***")
  );
}

function appendChangeLine(changeLine: string, oldLines: string[], newLines: string[]): void {
  if (changeLine.startsWith(" ")) {
    oldLines.push(changeLine.slice(1));
    newLines.push(changeLine.slice(1));
  } else if (changeLine.startsWith("-")) {
    oldLines.push(changeLine.slice(1));
  } else if (changeLine.startsWith("+")) {
    newLines.push(changeLine.slice(1));
  }
}

function stripHeredoc(input: string): string {
  const match = /^(?:cat\s+)?<<['"]?(\w+)['"]?\s*\n([\s\S]*?)\n\1\s*$/.exec(input);

  return match?.[2] ?? input;
}
