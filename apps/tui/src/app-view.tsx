import { Box, Text } from "ink";
import type {
  DisplayMessage,
  PendingPermission,
  PendingQuestion,
  SlashCommandInfo,
} from "./app-controller.js";

type AppViewProps = {
  activeAgentId: string;
  activeProviderId: string | undefined;
  canReadInput: boolean;
  effectiveModelProviderId: string | undefined;
  isBusy: boolean;
  messages: DisplayMessage[];
  mode: string;
  pendingPermission: PendingPermission | undefined;
  pendingQuestion: PendingQuestion | undefined;
  planFilePath: string | undefined;
  prompt: string;
  questionAnswer: string;
  riskLevel: string;
  sessionId: string | undefined;
  slashCommandSuggestions: SlashCommandInfo[];
  todoOpenCount: number;
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
      <Text>Todos: {props.todoOpenCount} open</Text>
      {props.planFilePath ? <Text>Plan: {props.planFilePath}</Text> : null}
      {props.isBusy ? <Text color="yellow">Running...</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {props.messages.map((message) => (
          <Text key={message.id}>{message.content}</Text>
        ))}
      </Box>
      <PermissionPrompt
        pendingPermission={props.pendingPermission}
        prompt={props.prompt}
        hidden={props.pendingQuestion !== undefined}
      />
      <QuestionPrompt pendingQuestion={props.pendingQuestion} answer={props.questionAnswer} />
      <SlashSuggestions commands={props.slashCommandSuggestions} />
      <Text dimColor>{getFooterText(props.canReadInput)}</Text>
    </Box>
  );
}

function QuestionPrompt(props: { pendingQuestion: PendingQuestion | undefined; answer: string }) {
  if (!props.pendingQuestion) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color="yellow">Question: answer below, press Enter to submit or Esc to cancel.</Text>
      {props.pendingQuestion.questions.map((question, questionIndex) => (
        <Box key={`${question.header}:${question.question}`} flexDirection="column" marginLeft={2}>
          <Text color="cyan">{`${questionIndex + 1}. ${question.header}`}</Text>
          <Text>{question.question}</Text>
          {question.options.map((option, optionIndex) => (
            <Text key={`${option.label}:${option.description}`} dimColor>
              {`${optionIndex + 1}) ${option.label} - ${option.description}`}
            </Text>
          ))}
          {question.multiple ? <Text dimColor>Multiple answers allowed.</Text> : null}
        </Box>
      ))}
      <Text>{`answer> ${props.answer}`}</Text>
    </Box>
  );
}

function PermissionPrompt(props: {
  pendingPermission: PendingPermission | undefined;
  prompt: string;
  hidden: boolean;
}) {
  if (props.hidden) {
    return null;
  }

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
