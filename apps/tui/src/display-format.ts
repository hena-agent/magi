export function truncateOneLine(value: string): string {
  const oneLine = value.replaceAll("\n", " ");

  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}...` : oneLine;
}

export function formatOutputSummary(output: string): string {
  const trimmed = output.trim();

  if (trimmed.length === 0) {
    return "empty output";
  }

  const lines = trimmed.split("\n");
  return lines.length === 1
    ? truncateOneLine(trimmed)
    : `${lines.length} lines: ${truncateOneLine(trimmed)}`;
}

export function formatOutputPreview(output: string): string | undefined {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const previewLines = lines.slice(0, 4);
  const suffix =
    lines.length > previewLines.length
      ? `\n  ... ${lines.length - previewLines.length} more lines`
      : "";
  return (
    [`preview:`, ...previewLines.map((line) => `  ${truncateOneLine(line)}`)].join("\n") + suffix
  );
}

export function readInputString(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function formatPatchTargets(input: unknown): string | undefined {
  const patch = readInputString(input, "patchText") ?? readInputString(input, "patch");
  if (!patch) {
    return undefined;
  }

  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^(?:\+\+\+ b\/|--- a\/|\*\*\* (?:Add|Update|Delete) File: )(.+)$/.exec(line);
    if (match?.[1] && match[1] !== "/dev/null") {
      paths.add(match[1].trim());
    }
  }

  if (paths.size === 0) {
    return undefined;
  }

  const pathList = [...paths];
  return pathList.length <= 3
    ? pathList.join(", ")
    : `${pathList.slice(0, 3).join(", ")} (+${pathList.length - 3} more)`;
}
