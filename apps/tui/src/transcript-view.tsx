import { Box, Text } from "ink";
import type { TranscriptMessage } from "./app-controller.js";
import { getTranscriptVisibleLineWindow } from "./transcript-state.js";

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
  const { visibleLines, olderHiddenCount, newerHiddenCount } = getTranscriptVisibleLineWindow({
    messages: props.messages,
    selectedId: props.selectedMessageId,
    expandedIds: props.expandedMessageIds,
    scrollOffset: props.scrollOffset,
  });

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
