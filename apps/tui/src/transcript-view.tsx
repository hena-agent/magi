import { Box, type DOMElement, measureElement, Text } from "ink";
import { useLayoutEffect, useRef } from "react";
import { getTranscriptVisibleLineWindow } from "./transcript-state.js";
import type { TranscriptMessage } from "./transcript-types.js";

type TranscriptViewProps = {
  activeStatus: string;
  activeAgentId: string;
  activeModelId: string;
  canReadInput: boolean;
  isBusy: boolean;
  lineLimit: number | undefined;
  messages: TranscriptMessage[];
  mode: string;
  planFilePath: string | undefined;
  queuedPromptCount: number;
  riskLevel: string;
  runVisualization: string;
  scrollOffset: number;
  selectedMessageId: string | undefined;
  showChrome?: boolean;
  sessionId: string | undefined;
  todoOpenCount: number;
  expandedMessageIds: Set<string>;
  workspaceRoot: string;
  compact?: boolean;
  fullscreen?: boolean;
  onLineLimitChange?: (lineLimit: number) => void;
};

export function TranscriptView(props: TranscriptViewProps) {
  const viewportRef = useTranscriptViewportMeasurement(props);
  const session = props.sessionId ? props.sessionId.slice(0, 8) : "draft";
  const showChrome = props.showChrome !== false;
  const showDashboard = shouldShowDashboard(props);
  const { visibleLines, olderHiddenCount, newerHiddenCount } = getTranscriptVisibleLineWindow({
    messages: props.messages,
    selectedId: props.selectedMessageId,
    expandedIds: props.expandedMessageIds,
    scrollOffset: props.scrollOffset,
    lineLimit: props.lineLimit,
  });

  return (
    <Box
      ref={viewportRef}
      flexDirection="column"
      borderStyle={props.fullscreen ? undefined : "single"}
      borderColor="gray"
      paddingX={1}
      flexGrow={props.fullscreen ? 1 : undefined}
      flexShrink={props.fullscreen ? 1 : undefined}
      minHeight={props.fullscreen ? 4 : undefined}
      overflowY={props.fullscreen ? "hidden" : undefined}
    >
      <TranscriptTop
        newerHiddenCount={newerHiddenCount}
        olderHiddenCount={olderHiddenCount}
        props={props}
        session={session}
        showChrome={showChrome}
      />
      <TranscriptBody
        activeAgentId={props.activeAgentId}
        activeModelId={props.activeModelId}
        compact={props.compact === true}
        showDashboard={showDashboard}
        visibleLines={visibleLines}
        workspaceRoot={props.workspaceRoot}
      />
      {showChrome ? (
        <TranscriptFooter
          activeStatus={props.activeStatus}
          canReadInput={props.canReadInput}
          isBusy={props.isBusy}
          queuedPromptCount={props.queuedPromptCount}
          scrollOffset={props.scrollOffset}
        />
      ) : null}
    </Box>
  );
}

function TranscriptTop(input: {
  newerHiddenCount: number;
  olderHiddenCount: number;
  props: TranscriptViewProps;
  session: string;
  showChrome: boolean;
}) {
  if (!input.showChrome) {
    return <HiddenLineIndicator older={input.olderHiddenCount} newer={input.newerHiddenCount} />;
  }

  return (
    <TranscriptHeader
      activeAgentId={input.props.activeAgentId}
      activeModelId={input.props.activeModelId}
      isBusy={input.props.isBusy}
      mode={input.props.mode}
      newerHiddenCount={input.newerHiddenCount}
      olderHiddenCount={input.olderHiddenCount}
      planFilePath={input.props.planFilePath}
      riskLevel={input.props.riskLevel}
      runVisualization={input.props.runVisualization}
      session={input.session}
      todoOpenCount={input.props.todoOpenCount}
      workspaceRoot={input.props.workspaceRoot}
    />
  );
}

function useTranscriptViewportMeasurement(props: TranscriptViewProps) {
  const viewportRef = useRef<DOMElement>(null);
  useLayoutEffect(() => {
    if (!props.fullscreen || !viewportRef.current || !props.onLineLimitChange) return;
    const { height } = measureElement(viewportRef.current);
    if (height > 0) props.onLineLimitChange(Math.max(4, height - 1));
  });
  return viewportRef;
}

function shouldShowDashboard(props: TranscriptViewProps): boolean {
  return (
    props.scrollOffset === 0 &&
    props.messages.length <= 1 &&
    props.messages.every((message) => message.id === "session-start")
  );
}

function TranscriptBody(props: {
  activeAgentId: string;
  activeModelId: string;
  showDashboard: boolean;
  visibleLines: ReturnType<typeof getTranscriptVisibleLineWindow>["visibleLines"];
  workspaceRoot: string;
  compact: boolean;
}) {
  if (props.showDashboard) {
    return (
      <StartDashboard
        activeAgentId={props.activeAgentId}
        activeModelId={props.activeModelId}
        compact={props.compact}
        workspaceRoot={props.workspaceRoot}
      />
    );
  }

  if (props.visibleLines.length === 0) return <Text dimColor>No messages yet.</Text>;

  return props.visibleLines.map((line) => (
    <Text
      key={line.key}
      dimColor={line.selected ? false : line.dim}
      bold={line.selected || line.bold}
      color={line.color}
    >
      {line.text}
    </Text>
  ));
}

function TranscriptHeader(props: {
  activeAgentId: string;
  activeModelId: string;
  isBusy: boolean;
  mode: string;
  newerHiddenCount: number;
  olderHiddenCount: number;
  planFilePath: string | undefined;
  riskLevel: string;
  runVisualization: string;
  session: string;
  todoOpenCount: number;
  workspaceRoot: string;
}) {
  return (
    <Box flexDirection="column">
      <Text bold>{props.isBusy ? "MAGI running" : "MAGI ready"}</Text>
      <Text dimColor>
        agent {props.activeAgentId} · model {props.activeModelId} · mode {props.mode} · session{" "}
        {props.session} · risk {props.riskLevel} · todos {props.todoOpenCount}
      </Text>
      <Text dimColor>
        {props.planFilePath ? `plan ${props.planFilePath}` : props.workspaceRoot}
      </Text>
      <Text dimColor>run {props.runVisualization}</Text>
      <HiddenLineIndicator older={props.olderHiddenCount} newer={props.newerHiddenCount} />
    </Box>
  );
}

function TranscriptFooter(props: {
  activeStatus: string;
  canReadInput: boolean;
  isBusy: boolean;
  queuedPromptCount: number;
  scrollOffset: number;
}) {
  return (
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
  );
}

function HiddenLineIndicator(props: { older: number; newer: number }) {
  const text = [
    props.older > 0 ? `${props.older} older lines` : undefined,
    props.newer > 0 ? `${props.newer} newer lines` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  return text.length > 0 ? <Text dimColor>{`  ┄ ${text}`}</Text> : null;
}

function StartDashboard(props: {
  activeAgentId: string;
  activeModelId: string;
  workspaceRoot: string;
  compact: boolean;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
      <Text bold>{workspaceName(props.workspaceRoot)}</Text>
      {!props.compact ? <Text dimColor>{props.workspaceRoot}</Text> : null}
      <Text dimColor>{`${props.activeAgentId} · ${props.activeModelId}`}</Text>
      <Box marginTop={props.compact ? 0 : 1}>
        <Text>Ask for a change, bug fix, or review.</Text>
      </Box>
      {!props.compact ? (
        <Text dimColor>/sessions resume · /model switch · /agent switch</Text>
      ) : null}
    </Box>
  );
}

function workspaceName(workspaceRoot: string): string {
  return workspaceRoot.split(/[\\/]/).filter(Boolean).at(-1) ?? workspaceRoot;
}
