import { Box, Text } from "ink";

export type OverlayMode = "permission" | "question" | "selector";
export type InputMode = OverlayMode | "suggestions";

export type StatusBarProps = {
  activeAgentId: string;
  activeProviderId: string | undefined;
  effectiveModelProviderId: string | undefined;
  isBusy: boolean;
  planFilePath: string | undefined;
  riskLevel: string;
  runVisualization: string;
  sessionId: string | undefined;
  todoOpenCount: number;
  workspaceRoot: string;
  compact: boolean;
  queuedPromptCount: number;
  terminalWidth: number;
};

export function StatusBar(props: StatusBarProps) {
  const model = props.activeProviderId ?? props.effectiveModelProviderId ?? "none";
  const session = props.sessionId ? props.sessionId.slice(0, 8) : "draft";
  const status = props.isBusy ? "RUNNING" : "READY";
  const firstLine = props.compact
    ? `MAGI · ${status} · ${props.activeAgentId}`
    : `MAGI  ${props.activeAgentId} · ${truncateMiddle(model, 30)} · ${session}  ${status}`;
  const secondLine = props.compact
    ? `${truncateMiddle(model, 24)} · ${props.riskLevel} risk · ${props.todoOpenCount} todos`
    : `${compactWorkspace(props.planFilePath ?? props.workspaceRoot)} · ${props.riskLevel} risk · ${props.todoOpenCount} todos · ${props.queuedPromptCount} queued`;

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Text bold>
        <Text color="cyan">MAGI</Text>
        {truncateEnd(firstLine, props.terminalWidth - 2).slice(4)}
      </Text>
      <Text dimColor>{truncateEnd(secondLine, props.terminalWidth - 2)}</Text>
      {!props.compact && props.isBusy ? (
        <Text dimColor>{truncateEnd(props.runVisualization, props.terminalWidth - 2)}</Text>
      ) : null}
    </Box>
  );
}

export type FooterBarProps = {
  activeStatus: string;
  canReadInput: boolean;
  isBusy: boolean;
  overlayMode: InputMode | undefined;
  queuedPromptCount: number;
  scrollOffset: number;
  compact: boolean;
  terminalWidth: number;
};

export function FooterBar(props: FooterBarProps) {
  if (!props.canReadInput) {
    return <Text dimColor>Watching for changes. Stop the dev process to quit.</Text>;
  }

  const activity = `${props.isBusy ? "running" : "ready"}${props.queuedPromptCount > 0 ? ` · ${props.queuedPromptCount} queued` : ""}${props.scrollOffset > 0 ? ` · ${props.scrollOffset} lines back` : ""}${props.activeStatus !== "Ready" ? ` · ${props.activeStatus}` : ""}`;

  return props.compact ? (
    <Text dimColor>{getCompactFooterText(props.overlayMode)}</Text>
  ) : (
    <Text dimColor>
      {truncateEnd(
        `${activity} · ${getFooterShortcutText(props.overlayMode)}`,
        props.terminalWidth,
      )}
    </Text>
  );
}

export function getFooterShortcutText(overlayMode: InputMode | undefined): string {
  switch (overlayMode) {
    case "permission":
      return "Permission: [y] allow [n] deny [esc] cancel";
    case "question":
      return "Question: ↑/↓ select space mark enter submit esc cancel";
    case "selector":
      return "Selector: ↑/↓ select enter confirm esc cancel";
    case "suggestions":
      return "↑/↓ select · tab/enter complete";
    default:
      return "/model · /agent · /sessions · /help · ctrl+c exit";
  }
}

function getCompactFooterText(overlayMode: InputMode | undefined): string {
  switch (overlayMode) {
    case "permission":
      return "y allow · n deny · esc cancel";
    case "question":
      return "↑↓ select · enter submit · esc";
    case "selector":
      return "↑↓ select · enter · esc";
    case "suggestions":
      return "↑↓ select · enter complete";
    default:
      return "/help · ctrl+c exit";
  }
}

function truncateMiddle(value: string, limit: number): string {
  if (value.length <= limit) return value;
  const side = Math.max(1, Math.floor((limit - 1) / 2));
  return `${value.slice(0, side)}…${value.slice(-side)}`;
}

function truncateEnd(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(1, limit - 1))}…`;
}

function compactWorkspace(value: string): string {
  const parts = value.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/") || value;
}
