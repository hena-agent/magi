import { Box, Text } from "ink";

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
};

export function StatusBar(props: StatusBarProps) {
  const model = props.activeProviderId ?? props.effectiveModelProviderId ?? "none";
  const session = props.sessionId ? props.sessionId.slice(0, 8) : "draft";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold>MAGI CODING ASSISTANT</Text>
        <Text bold>{props.isBusy ? "RUNNING" : "READY"}</Text>
      </Box>
      <Text>
        agent {props.activeAgentId} model {model} session {session} risk {props.riskLevel} todos{" "}
        {props.todoOpenCount}
      </Text>
      <Text>run {props.runVisualization}</Text>
      <Text dimColor>
        {props.planFilePath ? `plan ${props.planFilePath}` : props.workspaceRoot}
      </Text>
    </Box>
  );
}

export type FooterBarProps = {
  activeStatus: string;
  canReadInput: boolean;
  isBusy: boolean;
  queuedPromptCount: number;
  scrollOffset: number;
};

export function FooterBar(props: FooterBarProps) {
  if (!props.canReadInput) {
    return <Text dimColor>Watching for changes. Stop the dev process to quit.</Text>;
  }

  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{props.isBusy ? "running" : "ready"}</Text>
        {`  queued ${props.queuedPromptCount}  ${props.activeStatus}`}
        {props.scrollOffset > 0 ? `  scrolled ${props.scrollOffset} above latest` : ""}
      </Text>
      <Text dimColor>
        Shortcuts: /model switch model /agent switch agent /sessions resume /help commands ctrl+c
        exit
      </Text>
    </Box>
  );
}
