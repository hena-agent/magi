import { Box, Text } from "ink";

export type StatusBarProps = {
  activeAgentId: string;
  activeProviderId: string | undefined;
  effectiveModelProviderId: string | undefined;
  isBusy: boolean;
  planFilePath: string | undefined;
  riskLevel: string;
  sessionId: string | undefined;
  todoOpenCount: number;
  workspaceRoot: string;
};

export function StatusBar(props: StatusBarProps) {
  const model = props.activeProviderId ?? props.effectiveModelProviderId ?? "none";
  const session = props.sessionId ? props.sessionId.slice(0, 8) : "draft";

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Box justifyContent="space-between">
        <Text color="cyan" bold>
          MAGI
        </Text>
        <Text color={props.isBusy ? "yellow" : "green"}>{props.isBusy ? "running" : "ready"}</Text>
      </Box>
      <Text dimColor>
        {`agent ${props.activeAgentId}  model ${model}  session ${session}  risk ${props.riskLevel}  todos ${props.todoOpenCount}`}
      </Text>
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
    <Text dimColor>
      {`${props.isBusy ? "running" : "ready"}  queued ${props.queuedPromptCount}  /help commands  ↑ history  tab complete  ctrl+c exit`}
      {`  ${props.activeStatus}`}
      {props.scrollOffset > 0 ? `  scrolled ${props.scrollOffset} above latest` : ""}
    </Text>
  );
}
