import { Box, Text } from "ink";
import type { TranscriptMessage, TranscriptPart } from "./app-controller.js";

const transcriptLineLimit = 28;

type TranscriptLine = {
  id: string;
  key: string;
  text: string;
  dim?: boolean;
  bold?: boolean;
  color?: string;
  selected?: boolean;
};

export function TranscriptView(props: {
  activeStatus: string;
  activeAgentId: string;
  activeModelId: string;
  canReadInput: boolean;
  isBusy: boolean;
  messages: TranscriptMessage[];
  mode: string;
  planFilePath: string | undefined;
  queuedPromptCount: number;
  riskLevel: string;
  runVisualization: string;
  scrollOffset: number;
  selectedMessageId: string | undefined;
  sessionId: string | undefined;
  todoOpenCount: number;
  expandedMessageIds: Set<string>;
  workspaceRoot: string;
}) {
  const session = props.sessionId ? props.sessionId.slice(0, 8) : "draft";
  const showDashboard =
    props.scrollOffset === 0 &&
    props.messages.length <= 1 &&
    props.messages.every((message) => message.id === "session-start");
  const lines = props.messages.flatMap((message, index) =>
    formatMessageLines({
      message,
      first: index === 0,
      selectedId: props.selectedMessageId,
      expandedIds: props.expandedMessageIds,
    }),
  );
  const end = Math.max(0, lines.length - props.scrollOffset);
  const start = Math.max(0, end - transcriptLineLimit);
  const visibleLines = lines.slice(start, end);
  const olderHiddenCount = start;
  const newerHiddenCount = lines.length - end;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexDirection="column">
        <Text bold>{props.isBusy ? "MAGI running" : "MAGI ready"}</Text>
        <Text dimColor>
          agent {props.activeAgentId} · model {props.activeModelId} · mode {props.mode} · session{" "}
          {session} · risk {props.riskLevel} · todos {props.todoOpenCount}
        </Text>
        <Text dimColor>
          {props.planFilePath ? `plan ${props.planFilePath}` : props.workspaceRoot}
        </Text>
        <Text dimColor>run {props.runVisualization}</Text>
        <Text dimColor>
          {[
            olderHiddenCount > 0 ? `${olderHiddenCount} older lines` : undefined,
            newerHiddenCount > 0 ? `${newerHiddenCount} newer lines` : undefined,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Text>
      </Box>
      {showDashboard ? (
        <StartDashboard
          activeAgentId={props.activeAgentId}
          activeModelId={props.activeModelId}
          workspaceRoot={props.workspaceRoot}
        />
      ) : null}
      {visibleLines.length === 0 && !showDashboard ? <Text dimColor>No messages yet.</Text> : null}
      {visibleLines.map((line) => (
        <Text
          key={line.key}
          dimColor={line.selected ? false : line.dim}
          bold={line.selected || line.bold}
          color={line.color}
        >
          {line.text}
        </Text>
      ))}
      <Box flexDirection="column" marginTop={1}>
        <Text>
          <Text bold>{props.isBusy ? "running" : "ready"}</Text>
          {`  queued ${props.queuedPromptCount}  ${props.activeStatus}`}
          {props.scrollOffset > 0 ? `  scrolled ${props.scrollOffset} above latest` : ""}
        </Text>
        <Text dimColor>
          {props.canReadInput
            ? "Shortcuts: /model switch model /agent switch agent /sessions resume /help commands ctrl+c exit"
            : "Watching for changes. Stop the dev process to quit."}
        </Text>
      </Box>
    </Box>
  );
}

function StartDashboard(props: {
  activeAgentId: string;
  activeModelId: string;
  workspaceRoot: string;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>Ready to work in this repo</Text>
      <Text dimColor>{props.workspaceRoot}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text bold>Start:</Text> type a task and press Enter
        </Text>
        <Text>
          <Text bold>Switch model:</Text> /model
        </Text>
        <Text>
          <Text bold>Switch agent:</Text> /agent
        </Text>
        <Text>
          <Text bold>Resume work:</Text> /sessions
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text bold>Current lane</Text>
        <Text>{`agent ${props.activeAgentId}  model ${props.activeModelId}`}</Text>
      </Box>
      <Text dimColor>Transcript keys: PageUp/PageDown scroll, j/k select, Enter expand.</Text>
    </Box>
  );
}

function formatMessageLines(input: {
  message: TranscriptMessage;
  first: boolean;
  selectedId: string | undefined;
  expandedIds: Set<string>;
}): TranscriptLine[] {
  let lineIndex = 0;
  const nextLine = (line: Omit<TranscriptLine, "key">): TranscriptLine => ({
    ...line,
    key: `${input.message.id}:${lineIndex++}`,
  });
  const lines: TranscriptLine[] = input.first
    ? []
    : [nextLine({ id: input.message.id, text: "", dim: true })];

  if (input.message.role === "user") {
    const text = input.message.parts
      .filter((part): part is Extract<TranscriptPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n\n");
    const selected = input.selectedId === input.message.id;
    lines.push(
      nextLine({
        id: input.message.id,
        text: `${selected ? "›" : " "} │ You`,
        bold: true,
        selected,
      }),
      ...splitLines(text).map((line) =>
        nextLine({ id: input.message.id, text: `  │ ${line}`, selected }),
      ),
    );
    return lines;
  }

  if (input.message.role === "system") {
    for (const part of input.message.parts) {
      if (part.type !== "status" && part.type !== "text") continue;
      const selected = input.selectedId === input.message.id;
      const text = part.type === "status" ? part.text : part.text;
      lines.push(
        nextLine({
          id: input.message.id,
          text: `${selected ? "›" : " "} System`,
          dim: true,
          selected,
        }),
        ...splitLines(text).map((line) =>
          nextLine({ id: input.message.id, text: `  ${line}`, dim: true, selected }),
        ),
      );
    }
    return lines;
  }

  for (const part of input.message.parts) {
    lines.push(
      ...formatAssistantPartLines(input.message, part, input.selectedId, input.expandedIds),
    );
  }

  if (input.message.completedAt !== undefined || input.message.parts.length > 0) {
    const duration =
      input.message.createdAt !== undefined && input.message.completedAt !== undefined
        ? ` · ${formatDuration(input.message.completedAt - input.message.createdAt)}`
        : "";
    lines.push(
      nextLine({
        id: input.message.id,
        text: `  ▣ ${input.message.agentId ?? "assistant"}${input.message.model ? ` · ${input.message.model}` : ""}${duration}`,
        dim: true,
      }),
    );
  }

  return lines;
}

function formatAssistantPartLines(
  message: TranscriptMessage,
  part: TranscriptPart,
  selectedId: string | undefined,
  expandedIds: Set<string>,
): TranscriptLine[] {
  let index = 0;
  const selected = selectedId === part.id || selectedId === message.id;
  const nextLine = (line: Omit<TranscriptLine, "key">): TranscriptLine => ({
    ...line,
    key: `${message.id}:${part.id}:${index++}`,
  });

  if (part.type === "text") {
    if (!part.text.trim() || part.synthetic) return [];
    return splitLines(part.text.trim()).map((line, lineIndex) =>
      nextLine({
        id: message.id,
        text: `${lineIndex === 0 ? (selected ? "›" : " ") : " "} ${line}`,
        selected,
      }),
    );
  }

  if (part.type === "reasoning") {
    const expanded = expandedIds.has(part.id);
    const summary = summarizeReasoning(part.text);
    const label = part.time.end === undefined ? "Thinking" : "Thought";
    const duration =
      part.time.end === undefined ? undefined : formatDuration(part.time.end - part.time.start);
    const body = splitLines(part.text.trim() || "(no reasoning text emitted by provider)");
    const lines = [
      nextLine({
        id: part.id,
        text: `${selected ? "›" : " "} ${expanded ? "-" : "+"} ${label}${summary.title ? `: ${summary.title}` : ""}${duration ? ` · ${duration}` : ""}`,
        color: "yellow",
        dim: true,
        selected,
      }),
    ];
    if (expanded && body.length > 0) {
      lines.push(
        ...body.map((line) =>
          nextLine({ id: part.id, text: `  ${line}`, color: "yellow", dim: true, selected }),
        ),
      );
    }
    return lines;
  }

  if (part.type === "tool") {
    const expanded = expandedIds.has(part.id);
    const summary = formatToolSummary(part);
    const lines = [
      nextLine({
        id: part.id,
        text: `${selected ? "›" : " "} ${toolIcon(part.tool)} ${summary}${hasToolDetail(part) ? (expanded ? " [-]" : " [+]") : ""}`,
        dim:
          part.state.status !== "error" &&
          part.state.status !== "denied" &&
          part.state.status !== "skipped",
        color:
          part.state.status === "error" || part.state.status === "denied"
            ? "red"
            : part.state.status === "skipped"
              ? "yellow"
              : undefined,
        selected,
      }),
    ];
    const metadata = formatToolMetadata(part);
    lines.push(
      ...metadata.map((line) => nextLine({ id: part.id, text: `  ${line}`, dim: true, selected })),
    );
    if (expanded) {
      lines.push(
        ...formatToolDetail(part).flatMap((block) =>
          splitLines(block).map((line) =>
            nextLine({ id: part.id, text: `  ${line}`, dim: true, selected }),
          ),
        ),
      );
    }
    return lines;
  }

  const color = part.tone === "danger" ? "red" : part.tone === "warning" ? "yellow" : undefined;
  return splitLines(part.text).map((line, lineIndex) =>
    nextLine({
      id: part.id,
      text: `${lineIndex === 0 ? (selected ? "›" : " ") : " "} ${line}`,
      color,
      dim: part.tone !== "danger",
      selected,
    }),
  );
}

function formatToolSummary(part: Extract<TranscriptPart, { type: "tool" }>): string {
  const target = part.state.metadata?.target ?? formatToolInputTarget(part.tool, part.state.input);
  const status = part.state.status;
  if (status === "pending") return `${part.tool} preparing${target ? ` ${target}` : ""}`;
  if (status === "running") return `${part.tool} ${target ? `calling ${target}` : "running"}`;
  if (status === "skipped") return `${part.tool} skipped${target ? ` ${target}` : ""}`;
  if (status === "error") return `${part.tool} failed${target ? ` ${target}` : ""}`;
  if (status === "denied") return `${part.tool} denied${target ? ` ${target}` : ""}`;
  return `${part.tool} ${part.state.title ?? "completed"}${target ? ` ${target}` : ""}`;
}

function formatToolMetadata(part: Extract<TranscriptPart, { type: "tool" }>): string[] {
  return [
    part.state.metadata?.countLabel,
    part.state.metadata?.summary,
    part.state.metadata?.durationMs === undefined
      ? undefined
      : `duration ${formatDuration(part.state.metadata.durationMs)}`,
    part.state.metadata?.preview,
  ].filter((line): line is string => typeof line === "string" && line.length > 0);
}

function hasToolDetail(part: Extract<TranscriptPart, { type: "tool" }>): boolean {
  return part.state.input !== undefined || Boolean(part.state.output) || Boolean(part.state.error);
}

function formatToolDetail(part: Extract<TranscriptPart, { type: "tool" }>): string[] {
  const blocks: string[] = [];
  if (part.state.input !== undefined) blocks.push(`Input:\n${formatUnknown(part.state.input)}`);
  if (part.state.output) blocks.push(`Output:\n${part.state.output}`);
  if (part.state.error) blocks.push(`Error:\n${part.state.error}`);
  return blocks;
}

function summarizeReasoning(text: string): { title: string | undefined } {
  const firstLine = text
    .trim()
    .split("\n")
    .find((line) => line.trim().length > 0)
    ?.trim();
  if (!firstLine) return { title: undefined };
  return { title: firstLine.length > 90 ? `${firstLine.slice(0, 90)}...` : firstLine };
}

function formatToolInputTarget(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const record = input as Record<string, unknown>;
  const read = (key: string) => (typeof record[key] === "string" ? String(record[key]) : undefined);
  switch (toolName) {
    case "bash":
      return read("command");
    case "read":
      return read("filePath") ?? read("path");
    case "grep":
    case "glob":
      return read("pattern");
    case "webfetch":
      return read("url");
    case "websearch":
      return read("query");
    case "write":
    case "edit":
      return read("filePath");
    case "task":
      return read("description");
    default:
      return undefined;
  }
}

function toolIcon(tool: string): string {
  switch (tool) {
    case "bash":
      return "$";
    case "read":
      return "→";
    case "write":
    case "edit":
    case "apply_patch":
      return "←";
    case "grep":
    case "glob":
      return "✱";
    case "webfetch":
      return "%";
    case "websearch":
      return "◈";
    case "task":
      return "◇";
    default:
      return "⚙";
  }
}

function splitLines(value: string): string[] {
  const lines = value.split("\n");
  return lines.length === 0 ? [""] : lines;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}
