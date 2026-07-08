#!/usr/bin/env node
/** @jsxImportSource @opentui/react */
import { createCliRenderer, decodePasteBytes, stripAnsiSequences } from "@opentui/core";
import { createRoot, useKeyboard, useOnResize, usePaste } from "@opentui/react";
import { useEffect, useState } from "react";
import { OpenTuiCommandSuggestions } from "./opentui-command-suggestions.js";
import { createOpenTuiSessionBoot, type OpenTuiSessionBoot } from "./opentui-session-boot.js";
import {
  deletePreviousPromptWord,
  deletePromptCharacter,
  insertPromptText,
  setPromptText,
  type PromptState,
} from "./prompt-state.js";
import { OpenTuiComposer } from "./opentui-composer.js";
import { formatSlashCommandCompletion, getSlashCommandSuggestions } from "./slash-commands.js";
import {
  clampTranscriptScrollOffset,
  getTranscriptLineCount,
  getTranscriptMessageLineCount,
  isExpandableTranscriptId,
  keepTranscriptMessageOffsetVisible,
  selectTranscriptId,
} from "./transcript-state.js";
import { createSessionStartMessage } from "./tui-session-state.js";
import { isExitKey, normalizeOpenTuiKeyEvent } from "./tui-key-event.js";
import type { TranscriptMessage } from "./app-controller.js";
import { OpenTuiTranscript } from "./opentui-transcript.js";
import { createOpenTuiUserPromptMessage } from "./opentui-transcript-format.js";

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

type CliRenderer = Awaited<ReturnType<typeof createCliRenderer>>;

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

const rendererResult = await tryCreateOpenTuiRenderer({
  clearOnShutdown: false,
  exitOnCtrlC: false,
  height: terminalHeight,
  screenMode:
    process.env.MAGI_OPENTUI_ALTERNATE_SCREEN === "1" ? "alternate-screen" : "main-screen",
  width: terminalWidth,
});
if (!rendererResult) {
  process.exit(0);
}
const renderer = rendererResult;
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

async function tryCreateOpenTuiRenderer(
  options: Parameters<typeof createCliRenderer>[0],
): Promise<CliRenderer | undefined> {
  try {
    return await createCliRenderer(options);
  } catch (error) {
    renderNativeUnavailableScreen(error);
    return undefined;
  }
}

async function detectTerminalTextColor(currentRenderer: CliRenderer): Promise<string> {
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
  const [sessionBoot] = useState<OpenTuiSessionBoot>(() => createOpenTuiSessionBoot());
  const [terminalSize, setTerminalSize] = useState<TerminalSize>(() =>
    readTerminalSize(terminalWidth, terminalHeight),
  );
  const [prompt, setPrompt] = useState<PromptState>({ prompt: "", cursor: 0 });
  const [lastSubmittedPrompt, setLastSubmittedPrompt] = useState("(none)");
  const [transcriptMessages, setTranscriptMessages] = useState<TranscriptMessage[]>(() => [
    createSessionStartMessage(sessionBoot.initialSession),
  ]);
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>();
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0);
  const slashSuggestions = getSlashCommandSuggestions(prompt.prompt);
  const showTranscript = transcriptMessages.length > 1;
  const isCompact = terminalSize.width < 72 || terminalSize.height < 18;
  const contentWidth = Math.max(24, Math.min(terminalSize.width - 4, isCompact ? 72 : 90));
  const transcriptLineLimit = Math.max(4, terminalSize.height - (isCompact ? 9 : 12));

  useEffect(() => {
    return () => {
      sessionBoot.sessionStore?.close();
    };
  }, [sessionBoot.sessionStore]);

  useEffect(() => {
    setTranscriptScrollOffset((offset) =>
      clampTranscriptScrollOffset({
        messages: transcriptMessages,
        expandedIds: expandedMessageIds,
        offset,
        lineLimit: transcriptLineLimit,
      }),
    );
    if (selectedMessageId === undefined && transcriptMessages.length > 0) {
      setSelectedMessageId(transcriptMessages.at(-1)?.id);
    }
  }, [transcriptMessages, expandedMessageIds, selectedMessageId, transcriptLineLimit]);

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

    if (event.name === "pageup") {
      setTranscriptScrollOffset((offset) =>
        clampTranscriptScrollOffset({
          messages: transcriptMessages,
          expandedIds: expandedMessageIds,
          offset: offset + 8,
          lineLimit: transcriptLineLimit,
        }),
      );
      return;
    }

    if (event.name === "pagedown") {
      setTranscriptScrollOffset((offset) =>
        clampTranscriptScrollOffset({
          messages: transcriptMessages,
          expandedIds: expandedMessageIds,
          offset: offset - 8,
          lineLimit: transcriptLineLimit,
        }),
      );
      return;
    }

    if (event.name === "home") {
      setTranscriptScrollOffset(
        clampTranscriptScrollOffset({
          messages: transcriptMessages,
          expandedIds: expandedMessageIds,
          offset: getTranscriptLineCount(transcriptMessages, expandedMessageIds),
          lineLimit: transcriptLineLimit,
        }),
      );
      return;
    }

    if (event.name === "end") {
      setTranscriptScrollOffset(0);
      return;
    }

    if (prompt.prompt.length === 0 && event.input === "k") {
      selectOpenTuiTranscriptMessage(-1);
      return;
    }

    if (prompt.prompt.length === 0 && event.input === "j") {
      selectOpenTuiTranscriptMessage(1);
      return;
    }

    if (prompt.prompt.length === 0 && (event.input === " " || event.name === "return")) {
      toggleOpenTuiTranscriptExpansion();
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
        const message = createOpenTuiUserPromptMessage(submitted);
        setLastSubmittedPrompt(submitted);
        setTranscriptMessages((current) => [...current, message]);
        setSelectedMessageId(message.id);
        setTranscriptScrollOffset((offset) =>
          offset === 0
            ? 0
            : offset + getTranscriptMessageLineCount({ message, expandedIds: expandedMessageIds }),
        );
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

  function selectOpenTuiTranscriptMessage(direction: number): void {
    const nextMessageId = selectTranscriptId({
      messages: transcriptMessages,
      selectedId: selectedMessageId,
      direction,
    });
    if (!nextMessageId) return;

    setSelectedMessageId(nextMessageId);
    setTranscriptScrollOffset((offset) =>
      clampTranscriptScrollOffset({
        messages: transcriptMessages,
        expandedIds: expandedMessageIds,
        offset: keepTranscriptMessageOffsetVisible({
          messages: transcriptMessages,
          expandedIds: expandedMessageIds,
          messageId: nextMessageId,
          offset,
          lineLimit: transcriptLineLimit,
        }),
        lineLimit: transcriptLineLimit,
      }),
    );
  }

  function toggleOpenTuiTranscriptExpansion(): void {
    if (!selectedMessageId) return;
    if (!isExpandableTranscriptId(transcriptMessages, selectedMessageId)) return;

    setExpandedMessageIds((expandedIds) => {
      const next = new Set(expandedIds);
      if (next.has(selectedMessageId)) {
        next.delete(selectedMessageId);
      } else {
        next.add(selectedMessageId);
      }
      setTranscriptScrollOffset((offset) =>
        clampTranscriptScrollOffset({
          messages: transcriptMessages,
          expandedIds: next,
          offset: keepTranscriptMessageOffsetVisible({
            messages: transcriptMessages,
            expandedIds: next,
            messageId: selectedMessageId,
            offset,
            lineLimit: transcriptLineLimit,
          }),
          lineLimit: transcriptLineLimit,
        }),
      );
      return next;
    });
  }

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
        {showTranscript ? (
          <OpenTuiTranscript
            expandedMessageIds={expandedMessageIds}
            lineLimit={transcriptLineLimit}
            messages={transcriptMessages}
            mutedColor={theme.muted}
            scrollOffset={transcriptScrollOffset}
            selectedMessageId={selectedMessageId}
            textColor={theme.text}
            width={contentWidth}
          />
        ) : (
          <OpenTuiLanding
            contentWidth={contentWidth}
            isCompact={isCompact}
            sessionStoreError={sessionBoot.sessionStoreError}
            theme={theme}
          />
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
          hasSubmittedPrompt={showTranscript}
          lastSubmittedPrompt={lastSubmittedPrompt}
          theme={theme}
        />
      </box>
    </box>
  );
}

function OpenTuiLanding(props: {
  contentWidth: number;
  isCompact: boolean;
  sessionStoreError: string | undefined;
  theme: OpenTuiTheme;
}) {
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
        <text fg={props.sessionStoreError ? props.theme.warning : props.theme.muted}>
          {props.sessionStoreError
            ? "workspace session store unavailable in this runtime"
            : "workspace session state loaded"}
        </text>
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
    "This file contains the experimental native OpenTUI renderer.",
    "Use the stable Node info command instead:",
    "  pnpm --filter @magi/tui start:opentui",
    "",
    "Current migration work completed:",
    "  - OpenTUI dependencies installed",
    "  - shared key adapter added",
    "  - prompt-state extracted",
    "  - OpenTUI Composer, CommandSuggestions, and Transcript components added",
    "",
    "The default daily-driver TUI is still:",
    "  pnpm --filter @magi/tui start",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}

function renderNativeUnavailableScreen(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [
    "MAGI OpenTUI native renderer unavailable",
    "",
    "The Node/OpenTUI import shim loaded successfully, but OpenTUI core could not",
    "initialize its native render library in this runtime.",
    "",
    `Reason: ${message}`,
    "",
    "The default daily-driver TUI is still:",
    "  pnpm --filter @magi/tui start",
    "",
    "The stable OpenTUI migration status command is:",
    "  pnpm --filter @magi/tui start:opentui",
  ];

  process.stdout.write(`${lines.join("\n")}\n`);
}
