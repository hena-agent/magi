export type TerminalSize = {
  width: number;
  height: number;
};

export type TuiLayoutMode = "default" | "fullscreen";

export type TerminalDensity = "compact" | "regular" | "spacious";

export type TerminalLayout = {
  compact: boolean;
  density: TerminalDensity;
  composerMaxLines: number;
  suggestionLimit: number;
};

type TerminalWriter = {
  write(value: string): unknown;
};

export function shouldUseFullscreenTerminal(input: {
  stdinIsTTY: boolean | undefined;
  stdoutIsTTY: boolean | undefined;
}): boolean {
  return input.stdinIsTTY === true && input.stdoutIsTTY === true;
}

export function canUseFullscreenTerminal(): boolean {
  return shouldUseFullscreenTerminal({
    stdinIsTTY: process.stdin.isTTY,
    stdoutIsTTY: process.stdout.isTTY,
  });
}

export function readTerminalSize(stdout: NodeJS.WriteStream = process.stdout): TerminalSize {
  return {
    width: readTerminalDimension(stdout.columns, 80),
    height: readTerminalDimension(stdout.rows, 24),
  };
}

export function readTerminalDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && value > 0 ? value : fallback;
}

export function enterAlternateScreen(stdout: TerminalWriter = process.stdout): () => void {
  stdout.write("\u001b[?1049h\u001b[?25l\u001b[?1000h\u001b[?1006h");

  let restored = false;
  return () => {
    if (restored) return;
    restored = true;
    stdout.write("\u001b[?1006l\u001b[?1000l\u001b[?25h\u001b[?1049l");
  };
}

export function getTerminalLayout(size: TerminalSize): TerminalLayout {
  const compact = size.width < 72;
  const density: TerminalDensity =
    size.height < 18 ? "compact" : size.height >= 28 ? "spacious" : "regular";

  return {
    compact,
    density,
    composerMaxLines: density === "compact" ? 2 : density === "regular" ? 4 : 5,
    suggestionLimit: compact || density === "compact" ? 3 : 5,
  };
}

export function getTranscriptLineLimit(input: {
  mode: TuiLayoutMode;
  terminalHeight: number;
  hasOverlay?: boolean;
  suggestionCount?: number;
}): number | undefined {
  if (input.mode !== "fullscreen") return undefined;

  const suggestionLines = input.suggestionCount ? Math.min(input.suggestionCount + 2, 6) : 0;
  const overlayLines = input.hasOverlay ? 8 : 0;

  return Math.max(4, input.terminalHeight - 12 - suggestionLines - overlayLines);
}
