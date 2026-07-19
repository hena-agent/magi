import { describe, expect, it } from "vitest";
import {
  enterAlternateScreen,
  getTerminalLayout,
  getTranscriptLineLimit,
  readTerminalDimension,
  shouldUseFullscreenTerminal,
} from "./terminal-layout.js";

describe("terminal layout helpers", () => {
  it("uses safe terminal dimension fallbacks", () => {
    expect(readTerminalDimension(120, 80)).toBe(120);
    expect(readTerminalDimension(undefined, 80)).toBe(80);
    expect(readTerminalDimension(0, 80)).toBe(80);
  });

  it("only computes responsive transcript limits in fullscreen mode", () => {
    expect(getTranscriptLineLimit({ mode: "default", terminalHeight: 40 })).toBeUndefined();
    expect(getTranscriptLineLimit({ mode: "fullscreen", terminalHeight: 40 })).toBe(28);
    expect(getTranscriptLineLimit({ mode: "fullscreen", terminalHeight: 10 })).toBe(4);
  });

  it("reserves fullscreen space for overlays and suggestions", () => {
    expect(
      getTranscriptLineLimit({ mode: "fullscreen", terminalHeight: 40, suggestionCount: 3 }),
    ).toBe(23);
    expect(
      getTranscriptLineLimit({ mode: "fullscreen", terminalHeight: 40, hasOverlay: true }),
    ).toBe(20);
  });

  it("uses fullscreen only for interactive terminals", () => {
    expect(shouldUseFullscreenTerminal({ stdinIsTTY: true, stdoutIsTTY: true })).toBe(true);
    expect(shouldUseFullscreenTerminal({ stdinIsTTY: false, stdoutIsTTY: true })).toBe(false);
    expect(shouldUseFullscreenTerminal({ stdinIsTTY: true, stdoutIsTTY: undefined })).toBe(false);
  });

  it("restores alternate screen and cursor exactly once", () => {
    const writes: string[] = [];
    const restore = enterAlternateScreen({ write: (value) => writes.push(value) });

    restore();
    restore();

    expect(writes).toEqual(["\u001b[?1049h\u001b[?25l", "\u001b[?25h\u001b[?1049l"]);
  });

  it("selects responsive density and dock limits", () => {
    expect(getTerminalLayout({ width: 60, height: 16 })).toEqual({
      compact: true,
      density: "compact",
      composerMaxLines: 2,
      suggestionLimit: 3,
    });
    expect(getTerminalLayout({ width: 100, height: 40 })).toEqual({
      compact: false,
      density: "spacious",
      composerMaxLines: 5,
      suggestionLimit: 5,
    });
  });
});
