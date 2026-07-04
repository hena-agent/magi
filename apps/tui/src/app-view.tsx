import { Box, Text } from "ink";
import type { DisplayMessage, PendingPermission, SlashCommandInfo } from "./app-controller.js";

type AppViewProps = {
  activeAgentId: string;
  activeProviderId: string | undefined;
  canReadInput: boolean;
  effectiveModelProviderId: string | undefined;
  isBusy: boolean;
  messages: DisplayMessage[];
  mode: string;
  pendingPermission: PendingPermission | undefined;
  prompt: string;
  riskLevel: string;
  sessionId: string | undefined;
  slashCommandSuggestions: SlashCommandInfo[];
  workspaceRoot: string;
};

export function AppView(props: AppViewProps) {
  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        MAGI
      </Text>
      <Text>Mode: {props.mode}</Text>
      <Text>Agent: {props.activeAgentId}</Text>
      <Text>Model: {props.activeProviderId ?? props.effectiveModelProviderId ?? "none"}</Text>
      <Text>Risk: {props.riskLevel}</Text>
      <Text>Workspace: {props.workspaceRoot}</Text>
      <Text>Session: {props.sessionId ?? "draft"}</Text>
      {props.isBusy ? <Text color="yellow">Running...</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {props.messages.map((message) => (
          <Text key={message.id}>{message.content}</Text>
        ))}
      </Box>
      <PermissionPrompt pendingPermission={props.pendingPermission} prompt={props.prompt} />
      <SlashSuggestions commands={props.slashCommandSuggestions} />
      <Text dimColor>{getFooterText(props.canReadInput)}</Text>
    </Box>
  );
}

function PermissionPrompt(props: {
  pendingPermission: PendingPermission | undefined;
  prompt: string;
}) {
  return (
    <>
      {props.pendingPermission ? (
        <Text color="yellow">{`Permission: ${props.pendingPermission.description}`}</Text>
      ) : null}
      <Text>{props.pendingPermission ? "Allow? [y/N]" : `> ${props.prompt}`}</Text>
    </>
  );
}

function SlashSuggestions(props: { commands: SlashCommandInfo[] }) {
  if (props.commands.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginLeft={2}>
      {props.commands.map((command) => (
        <Text key={command.name}>
          <Text color="cyan">{command.usage}</Text>
          <Text dimColor>{`  ${command.description}`}</Text>
        </Text>
      ))}
    </Box>
  );
}

function getFooterText(canReadInput: boolean): string {
  return canReadInput
    ? "Type a prompt, /help for commands, or q on an empty prompt to quit."
    : "Watching for changes. Stop the dev process to quit.";
}
