#!/usr/bin/env bun
/** @jsxImportSource @opentui/react */
import { createCliRenderer, decodePasteBytes, stripAnsiSequences } from "@opentui/core";
import { createRoot, useKeyboard, useOnResize, usePaste } from "@opentui/react";
import { useState } from "react";
import { OpenTuiCommandSuggestions } from "./opentui-command-suggestions.js";
import {
  deletePreviousPromptWord,
  deletePromptCharacter,
  insertPromptText,
  setPromptText,
  type PromptState,
} from "./prompt-state.js";
import { OpenTuiComposer } from "./opentui-composer.js";
import { formatSlashCommandCompletion, getSlashCommandSuggestions } from "./slash-commands.js";
import { isExitKey, normalizeOpenTuiKeyEvent } from "./tui-key-event.js";

const colors = {
  accent: "#22d3ee",
  brand: "#8b5cf6",
  muted: "#94a3b8",
  success: "#047857",
  warning: "#d97706",
};

type OpenTuiTheme = typeof colors & {
  text: string;
};

type TerminalSize = {
  width: number;
  height: number;
};

const openTuiLogoLines = [
  String.raw` __  __    _    ____ ___`,
  String.raw`|  \/  |  / \  / ___|_ _|`,
  String.raw`| |\/| | / _ \| |  _ | | `,
  String.raw`| |  | |/ ___ \ |_| || | `,
  String.raw`|_|  |_/_/   \_\____|___|`,
];

if (process.env.MAGI_OPENTUI_NATIVE !== "1") {
  renderFallbackOpenTuiScreen();
  process.exit(0);
}

const terminalWidth = readTerminalDimension(process.stdout.columns, 80);
const terminalHeight = readTerminalDimension(process.stdout.rows, 24);

const renderer = await createCliRenderer({
  clearOnShutdown: false,
  exitOnCtrlC: false,
  height: terminalHeight,
  screenMode:
    process.env.MAGI_OPENTUI_ALTERNATE_SCREEN === "1" ? "alternate-screen" : "main-screen",
  width: terminalWidth,
});
const theme: OpenTuiTheme = {
  ...colors,
  text: await detectTerminalTextColor(renderer),
};
const root = createRoot(renderer);
let shuttingDown = false;

function shutdown(): void {
  if (shuttingDown) return;
  shuttingDown = true;
  root.unmount();
  renderer.destroy();
  process.exit(0);
}

function readTerminalDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && value > 0 ? value : fallback;
}

function readTerminalSize(widthFallback = 80, heightFallback = 24): TerminalSize {
  return {
    height: readTerminalDimension(process.stdout.rows, heightFallback),
    width: readTerminalDimension(process.stdout.columns, widthFallback),
  };
}

async function detectTerminalTextColor(currentRenderer: typeof renderer): Promise<string> {
  if (process.env.MAGI_OPENTUI_TEXT_COLOR) return process.env.MAGI_OPENTUI_TEXT_COLOR;

  try {
    const palette = await currentRenderer.getPalette({ timeout: 750 });
    if (palette.defaultForeground) return palette.defaultForeground;

    return pickTextColorForBackground(palette.defaultBackground);
  } catch {
    return pickTextColorForColorFgBg(process.env.COLORFGBG);
  }
}

function pickTextColorForBackground(background: string | null): string {
  if (!background) return pickTextColorForColorFgBg(process.env.COLORFGBG);

  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(background);
  if (!match) return pickTextColorForColorFgBg(process.env.COLORFGBG);

  const [, redHex, greenHex, blueHex] = match;
  if (!redHex || !greenHex || !blueHex) return pickTextColorForColorFgBg(process.env.COLORFGBG);

  const red = Number.parseInt(redHex, 16);
  const green = Number.parseInt(greenHex, 16);
  const blue = Number.parseInt(blueHex, 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  return luminance > 0.55 ? "#111827" : "#f9fafb";
}

function pickTextColorForColorFgBg(colorFgBg: string | undefined): string {
  const backgroundIndex = colorFgBg?.split(";").at(-1);
  if (!backgroundIndex) return "#111827";

  const parsedBackgroundIndex = Number.parseInt(backgroundIndex, 10);
  if (!Number.isFinite(parsedBackgroundIndex)) return "#111827";

  return parsedBackgroundIndex >= 7 && parsedBackgroundIndex <= 15 ? "#111827" : "#f9fafb";
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

function OpenTuiBootApp() {
  const [terminalSize, setTerminalSize] = useState<TerminalSize>(() =>
    readTerminalSize(terminalWidth, terminalHeight),
  );
  const [prompt, setPrompt] = useState<PromptState>({ prompt: "", cursor: 0 });
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("(none)");
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0);
  const slashSuggestions = getSlashCommandSuggestions(prompt.prompt);
  const hasSubmittedPrompt = lastSubmittedPrompt !== "(none)";
  const isCompact = terminalSize.width < 72 || terminalSize.height < 18;
  const contentWidth = Math.max(24, Math.min(terminalSize.width - 4, isCompact ? 72 : 90));

  useOnResize((width, height) => {
    setTerminalSize({
      height: readTerminalDimension(height, terminalHeight),
      width: readTerminalDimension(width, terminalWidth),
    });
  });

  usePaste((event) => {
    const pastedText = stripAnsiSequences(decodePasteBytes(event.bytes));
    if (pastedText.length === 0) return;

    setPrompt((current) => insertPromptText(current, pastedText));
    setSlashSelectionIndex(0);
    event.preventDefault();
  });

  useKeyboard((key) => {
    const event = normalizeOpenTuiKeyEvent(key);
    if (isExitKey(event)) {
      shutdown();
      return;
    }

    if (slashSuggestions.length > 0 && event.name === "up") {
      setSlashSelectionIndex((index) => (index <= 0 ? slashSuggestions.length - 1 : index - 1));
      return;
    }

    if (slashSuggestions.length > 0 && event.name === "down") {
      setSlashSelectionIndex((index) => (index + 1) % slashSuggestions.length);
      return;
    }

    if (slashSuggestions.length > 0 && (event.name === "tab" || event.name === "return")) {
      const selected = slashSuggestions[slashSelectionIndex] ?? slashSuggestions[0];
      if (selected) {
        setPrompt(setPromptText(formatSlashCommandCompletion(selected)));
        setSlashSelectionIndex(0);
      }
      return;
    }

    if (event.name === "left" || (event.name === "b" && event.ctrl)) {
      setPrompt((current) => setPromptText(current.prompt, current.cursor - 1));
      return;
    }

    if (event.name === "right" || (event.name === "f" && event.ctrl)) {
      setPrompt((current) => setPromptText(current.prompt, current.cursor + 1));
      return;
    }

    if (event.name === "a" && event.ctrl) {
      setPrompt((current) => setPromptText(current.prompt, 0));
      return;
    }

    if (event.name === "e" && event.ctrl) {
      setPrompt((current) => setPromptText(current.prompt));
      return;
    }

    if (event.name === "u" && event.ctrl) {
      setPrompt(setPromptText(""));
      return;
    }

    if (event.name === "w" && event.ctrl) {
      setPrompt(deletePreviousPromptWord);
      return;
    }

    if (event.name === "backspace" || event.name === "delete") {
      setPrompt(deletePromptCharacter);
      return;
    }

    if (event.name === "return") {
      const submitted = prompt.prompt.trim();
      if (submitted.length > 0) {
        setLastSubmittedPrompt(submitted);
        setPrompt(setPromptText(""));
        setSlashSelectionIndex(0);
      }
      return;
    }

    if (event.input.length > 0) {
      setPrompt((current) => insertPromptText(current, event.input));
      setSlashSelectionIndex(0);
    }
  });

  return (
    <box height={terminalSize.height} width={terminalSize.width} style={{ padding: 1 }}>
      <box
        style={{
          alignItems: "center",
          flexDirection: "column",
          flexGrow: 1,
          justifyContent: "center",
        }}
      >
        {hasSubmittedPrompt ? (
          <OpenTuiSessionSummary
            contentWidth={contentWidth}
            isCompact={isCompact}
            lastSubmittedPrompt={lastSubmittedPrompt}
            theme={theme}
          />
        ) : (
          <OpenTuiLanding contentWidth={contentWidth} isCompact={isCompact} theme={theme} />
        )}
        <OpenTuiComposer
          prompt={prompt.prompt}
          cursor={prompt.cursor}
          disabled={false}
          placeholder='Ask anything... "Fix a TODO in the codebase"'
          textColor={theme.text}
          width={contentWidth}
        />
        <OpenTuiCommandSuggestions
          commands={slashSuggestions}
          selectedIndex={slashSelectionIndex}
          hidden={false}
          textColor={theme.text}
          width={contentWidth}
        />
        <OpenTuiFooter
          contentWidth={contentWidth}
          hasSubmittedPrompt={hasSubmittedPrompt}
          lastSubmittedPrompt={lastSubmittedPrompt}
          theme={theme}
        />
      </box>
    </box>
  );
}

function OpenTuiLanding(props: { contentWidth: number; isCompact: boolean; theme: OpenTuiTheme }) {
  return (
    <box
      style={{
        alignItems: "center",
        flexDirection: "column",
      }}
    >
      {!props.isCompact && <OpenTuiLogo theme={props.theme} />}
      <box width={props.contentWidth} style={{ flexDirection: "column", paddingLeft: 1 }}>
        <text fg={props.theme.muted}>Build - GPT-5.5 OpenAI</text>
        <text fg={props.theme.muted}>tab agents ctrl+p commands</text>
      </box>
      {!props.isCompact && (
        <box width={props.contentWidth} style={{ marginTop: 2, paddingLeft: 1 }}>
          <text fg={props.theme.warning}>Tip type / for commands</text>
        </box>
      )}
    </box>
  );
}

function OpenTuiLogo(props: { theme: OpenTuiTheme }) {
  return (
    <box style={{ flexDirection: "column", marginBottom: 1 }}>
      {openTuiLogoLines.map((line) => (
        <text fg={props.theme.brand} key={line}>
          {line}
        </text>
      ))}
    </box>
  );
}

function OpenTuiSessionSummary(props: {
  contentWidth: number;
  isCompact: boolean;
  lastSubmittedPrompt: string;
  theme: OpenTuiTheme;
}) {
  return (
    <box
      width={props.contentWidth}
      style={{
        flexDirection: "column",
        marginBottom: props.isCompact ? 1 : 2,
        padding: 1,
      }}
    >
      <text fg={props.theme.text}>Last prompt</text>
      <text fg={props.theme.success}>{props.lastSubmittedPrompt}</text>
      <text fg={props.theme.muted}>OpenTUI prototype is ready for the next prompt.</text>
    </box>
  );
}

function OpenTuiFooter(props: {
  contentWidth: number;
  hasSubmittedPrompt: boolean;
  lastSubmittedPrompt: string;
  theme: OpenTuiTheme;
}) {
  return (
    <box width={props.contentWidth} style={{ flexDirection: "column", paddingLeft: 1 }}>
      {props.hasSubmittedPrompt && (
        <text fg={props.theme.text}>last submitted: {props.lastSubmittedPrompt}</text>
      )}
      <text fg={props.theme.muted}>q/ctrl+c exit tab complete enter submit</text>
    </box>
  );
}

root.render(<OpenTuiBootApp />);

if (process.env.MAGI_OPENTUI_SMOKE === "1") {
  setTimeout(shutdown, 50);
}

function renderFallbackOpenTuiScreen(): void {
  const lines = [
    "MAGI OpenTUI migration baseline",
    "",
    "This info command does not enter the native OpenTUI renderer because it",
    "clears the screen without reliably drawing on this terminal/runtime combination.",
    "",
    "Run the native renderer with either:",
    "  pnpm --filter @magi/tui start:opentui",
    "or:",
    "  pnpm --filter @magi/tui start:opentui:native",
    "",
    "Current migration work completed:",
    "  - OpenTUI dependencies installed",
    "  - shared key adapter added",
    "  - prompt-state extracted",
    "  - OpenTUI Composer and CommandSuggestions components added",
    "",
    "The default daily-driver TUI is still:",
    "  pnpm --filter @magi/tui start",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}
