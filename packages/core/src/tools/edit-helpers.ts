export function replaceContent(
  content: string,
  oldString: string,
  newString: string,
  replaceAll: boolean,
): string {
  const old = convertToDetectedLineEnding(
    normalizeLineEndings(oldString),
    detectLineEnding(content),
  );
  const replacement = convertToDetectedLineEnding(
    normalizeLineEndings(newString),
    detectLineEnding(content),
  );
  let foundAny = false;

  for (const search of replacementCandidates(content, old)) {
    const index = content.indexOf(search);

    if (index === -1) {
      continue;
    }

    foundAny = true;

    if (replaceAll) {
      return content.replaceAll(search, replacement);
    }

    if (index !== content.lastIndexOf(search)) {
      continue;
    }

    return `${content.slice(0, index)}${replacement}${content.slice(index + search.length)}`;
  }

  if (!foundAny) {
    throw new Error(
      "Could not find oldString in the file. It must match exactly, including whitespace.",
    );
  }

  throw new Error(
    "Found multiple matches for oldString. Provide more surrounding context or use replaceAll.",
  );
}

function replacementCandidates(content: string, find: string): string[] {
  const candidates = new Set<string>();

  if (find.length > 0) {
    candidates.add(find);
  }

  for (const match of lineTrimmedCandidates(content, find)) {
    candidates.add(match);
  }

  for (const match of indentationFlexibleCandidates(content, find)) {
    candidates.add(match);
  }

  for (const match of whitespaceNormalizedCandidates(content, find)) {
    candidates.add(match);
  }

  const trimmed = find.trim();
  if (trimmed !== find && trimmed.length > 0) {
    candidates.add(trimmed);
  }

  return [...candidates];
}

function lineTrimmedCandidates(content: string, find: string): string[] {
  const lines = content.split("\n");
  const searchLines = trimTrailingEmptyLine(find.split("\n"));
  const matches: string[] = [];

  for (let index = 0; index <= lines.length - searchLines.length; index += 1) {
    const block = lines.slice(index, index + searchLines.length);

    if (block.every((line, offset) => line.trim() === searchLines[offset]?.trim())) {
      matches.push(block.join("\n"));
    }
  }

  return matches;
}

function indentationFlexibleCandidates(content: string, find: string): string[] {
  const lines = content.split("\n");
  const searchLines = find.split("\n");
  const normalizedFind = removeCommonIndent(find);
  const matches: string[] = [];

  for (let index = 0; index <= lines.length - searchLines.length; index += 1) {
    const block = lines.slice(index, index + searchLines.length).join("\n");

    if (removeCommonIndent(block) === normalizedFind) {
      matches.push(block);
    }
  }

  return matches;
}

function whitespaceNormalizedCandidates(content: string, find: string): string[] {
  const normalizedFind = normalizeWhitespace(find);
  const lines = content.split("\n");
  const matches: string[] = [];

  for (const line of lines) {
    if (normalizeWhitespace(line) === normalizedFind) {
      matches.push(line);
    }
  }

  const searchLineCount = find.split("\n").length;
  if (searchLineCount > 1) {
    for (let index = 0; index <= lines.length - searchLineCount; index += 1) {
      const block = lines.slice(index, index + searchLineCount).join("\n");

      if (normalizeWhitespace(block) === normalizedFind) {
        matches.push(block);
      }
    }
  }

  return matches;
}

function removeCommonIndent(value: string): string {
  const lines = value.split("\n");
  const nonEmptyLines = lines.filter((line) => line.trim().length > 0);

  if (nonEmptyLines.length === 0) {
    return value;
  }

  const minIndent = Math.min(...nonEmptyLines.map((line) => line.match(/^\s*/)?.[0].length ?? 0));

  return lines.map((line) => (line.trim().length === 0 ? line : line.slice(minIndent))).join("\n");
}

function trimTrailingEmptyLine(lines: string[]): string[] {
  return lines.at(-1) === "" ? lines.slice(0, -1) : lines;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function detectLineEnding(value: string): "\n" | "\r\n" {
  return value.includes("\r\n") ? "\r\n" : "\n";
}

function convertToDetectedLineEnding(value: string, lineEnding: "\n" | "\r\n"): string {
  return lineEnding === "\n" ? value : value.replaceAll("\n", "\r\n");
}
