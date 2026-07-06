import { Box, Text } from "ink";
import type { DisplayMessage } from "./app-controller.js";

const transcriptLineLimit = 28;

type TranscriptLine = {
  id: string;
  key: string;
  text: string;
  color?: string;
  dim?: boolean;
  bold?: boolean;
  selected?: boolean;
};

export function TranscriptView(props: {
  activeAgentId: string;
  activeModelId: string;
  messages: DisplayMessage[];
  scrollOffset: number;
  selectedMessageId: string | undefined;
  expandedMessageIds: Set<string>;
  workspaceRoot: string;
}) {
  const showDashboard =
    props.scrollOffset === 0 &&
    props.messages.length <= 1 &&
    props.messages.every((message) => message.id === "session-start");
  const lines = props.messages.flatMap((message) =>
    formatMessageLines({
      message,
      selected: message.id === props.selectedMessageId,
      expanded: props.expandedMessageIds.has(message.id),
    }),
  );
  const end = Math.max(0, lines.length - props.scrollOffset);
  const start = Math.max(0, end - transcriptLineLimit);
  const visibleLines = lines.slice(start, end);
  const olderHiddenCount = start;
  const newerHiddenCount = lines.length - end;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="white" bold>
          Transcript
        </Text>
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
          color={line.color}
          dimColor={line.dim}
          bold={line.bold}
          backgroundColor={line.selected ? "cyan" : undefined}
        >
          {line.selected ? ` ${line.text}` : line.text}
        </Text>
      ))}
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
      <Text color="cyan" bold>
        Ready to work in this repo
      </Text>
      <Text dimColor>{props.workspaceRoot}</Text>
      <Box marginTop={1} flexDirection="column">
        <Text>
          <Text color="green" bold>
            Start:
          </Text>{" "}
          type a task and press Enter
        </Text>
        <Text>
          <Text color="cyan" bold>
            Switch model:
          </Text>{" "}
          /model
        </Text>
        <Text>
          <Text color="cyan" bold>
            Switch agent:
          </Text>{" "}
          /agent
        </Text>
        <Text>
          <Text color="cyan" bold>
            Resume work:
          </Text>{" "}
          /sessions
        </Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color="yellow">Current lane</Text>
        <Text>{`agent ${props.activeAgentId}  model ${props.activeModelId}`}</Text>
      </Box>
      <Text dimColor>Transcript keys: PageUp/PageDown scroll, j/k select, Enter expand.</Text>
    </Box>
  );
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Keeping transcript card flattening in one place keeps selection and expansion rendering consistent.
function formatMessageLines(input: {
  message: DisplayMessage;
  selected: boolean;
  expanded: boolean;
}): TranscriptLine[] {
  const kind = input.message.kind ?? inferMessageKind(input.message.content);
  const title = input.message.title ?? getMessageTitle(kind, input.message.content);
  const body = stripMessagePrefix(kind, input.message.content);
  const marker = input.selected ? "›" : " ";
  const affordance = input.message.expandable ? (input.expanded ? " [-]" : " [+]") : "";
  const metadataLines = formatMetadataLines(input.message.metadata);
  let lineIndex = 0;
  const nextLine = (line: Omit<TranscriptLine, "key">): TranscriptLine => ({
    ...line,
    key: `${input.message.id}:${lineIndex++}`,
  });
  const lines: TranscriptLine[] = [
    nextLine({ id: input.message.id, text: "", dim: true }),
    nextLine({
      id: input.message.id,
      text: `${marker} ${title}${affordance}`,
      color: getKindColor(kind),
      bold: true,
      selected: input.selected,
    }),
    ...splitMessageText(body).map((text) => ({
      id: input.message.id,
      key: `${input.message.id}:${lineIndex++}`,
      text: `  ${text}`,
      color: getToneColor(input.message.tone),
      selected: input.selected,
    })),
    ...metadataLines.map((text) => ({
      id: input.message.id,
      key: `${input.message.id}:${lineIndex++}`,
      text: `  ${text}`,
      dim: true,
      selected: input.selected,
    })),
  ];

  if (input.message.expandable && input.expanded && input.message.detail) {
    lines.push(
      ...splitMessageText(input.message.detail).map((text) => ({
        id: input.message.id,
        key: `${input.message.id}:${lineIndex++}`,
        text: `  ${text}`,
        dim: true,
        selected: input.selected,
      })),
    );
  }

  if (input.message.expandable && !input.expanded) {
    lines.push(
      nextLine({
        id: input.message.id,
        text: "  Press enter/space on an empty prompt to expand.",
        dim: true,
        selected: input.selected,
      }),
    );
  }

  return lines;
}

function formatMetadataLines(metadata: DisplayMessage["metadata"]): string[] {
  if (!metadata) return [];

  return [
    metadata.target,
    metadata.durationMs === undefined
      ? undefined
      : `duration ${formatDuration(metadata.durationMs)}`,
    metadata.countLabel,
    metadata.summary,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
}

function formatDuration(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function splitMessageText(value: string): string[] {
  const lines = value.split("\n");
  return lines.length === 0 ? [""] : lines;
}

function inferMessageKind(content: string): NonNullable<DisplayMessage["kind"]> {
  if (/^User:/i.test(content)) return "user";
  if (/^Assistant:/i.test(content)) return "assistant";
  if (
    /^(read|glob|grep|bash|webfetch|websearch|todowrite|skill|lsp_|apply_patch|edit|write):/i.test(
      content,
    )
  )
    return "tool";
  if (/error|failed|denied/i.test(content)) return "error";
  if (/verify|summary|model|agent|task|plan_exit|MAGI/i.test(content)) return "status";
  return "system";
}

function getMessageTitle(kind: NonNullable<DisplayMessage["kind"]>, content: string): string {
  if (kind === "tool") return `Tool: ${content.split(":", 1)[0]}`;
  if (kind === "user") return "You";
  if (kind === "assistant") return "Assistant";
  if (kind === "error") return "Error";
  if (kind === "status") return "Status";
  return "System";
}

function stripMessagePrefix(kind: NonNullable<DisplayMessage["kind"]>, content: string): string {
  if (kind === "user") return content.replace(/^User:\s*/i, "");
  if (kind === "assistant") return content.replace(/^Assistant:\s*/i, "");
  return content;
}

function getKindColor(kind: NonNullable<DisplayMessage["kind"]>): string {
  switch (kind) {
    case "user":
      return "cyan";
    case "assistant":
      return "green";
    case "tool":
      return "magenta";
    case "error":
      return "red";
    case "status":
      return "yellow";
    case "system":
      return "gray";
  }
}

function getToneColor(tone: DisplayMessage["tone"]): string | undefined {
  switch (tone) {
    case "muted":
      return "gray";
    case "success":
      return "green";
    case "warning":
      return "yellow";
    case "danger":
      return "red";
    default:
      return undefined;
  }
}
