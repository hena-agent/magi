import { Box, Text } from "ink";
import type { ActiveRunState } from "./app-controller.js";

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
          MAGI CODING ASSISTANT
        </Text>
        <Text color={props.isBusy ? "yellow" : "green"} bold>
          {props.isBusy ? "RUNNING" : "READY"}
        </Text>
      </Box>
      <Text>
        <Text color="green">agent</Text> {props.activeAgentId} <Text color="green">model</Text>{" "}
        {model} <Text color="green">session</Text> {session} <Text color="green">risk</Text>{" "}
        {props.riskLevel} <Text color="green">todos</Text> {props.todoOpenCount}
      </Text>
      <Text dimColor>
        {props.planFilePath ? `plan ${props.planFilePath}` : props.workspaceRoot}
      </Text>
    </Box>
  );
}

export type FooterBarProps = {
  activeRunState: ActiveRunState | undefined;
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
        <Text color={props.isBusy ? "yellow" : "green"}>{props.isBusy ? "running" : "ready"}</Text>
        {`  queued ${props.queuedPromptCount}  ${formatActiveProgress(props.activeRunState, props.activeStatus)}`}
        {props.scrollOffset > 0 ? `  scrolled ${props.scrollOffset} above latest` : ""}
      </Text>
      <Text dimColor>
        Shortcuts: /model switch model /agent switch agent /sessions resume /help commands ctrl+c
        exit
      </Text>
    </Box>
  );
}

function formatActiveProgress(
  activeRunState: ActiveRunState | undefined,
  fallback: string,
): string {
  if (!activeRunState) return fallback;

  const parts = [activeRunState.command, activeRunState.agentId, activeRunState.phase].filter(
    Boolean,
  );
  if (activeRunState.step && activeRunState.maxSteps) {
    parts.push(`step ${activeRunState.step}/${activeRunState.maxSteps}`);
  }
  if (activeRunState.detail) {
    parts.push(activeRunState.detail);
  }

  return parts.join("  ");
}
