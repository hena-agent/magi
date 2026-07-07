import { Box } from "ink";
import type {
  PendingPermission,
  PendingQuestion,
  PendingSelector,
  TranscriptMessage,
} from "./app-controller.js";
import { CommandSuggestions } from "./command-suggestions.js";
import { Composer } from "./composer.js";
import { OverlayArea } from "./overlays.js";
import type { SlashCommandInfo } from "./slash-commands.js";
import { TranscriptView } from "./transcript-view.js";

type AppViewProps = {
  activeStatus: string;
  activeAgentId: string;
  activeProviderId: string | undefined;
  canReadInput: boolean;
  effectiveModelProviderId: string | undefined;
  expandedMessageIds: Set<string>;
  isBusy: boolean;
  messages: TranscriptMessage[];
  mode: string;
  pendingPermission: PendingPermission | undefined;
  pendingQuestion: PendingQuestion | undefined;
  pendingSelector: PendingSelector | undefined;
  planFilePath: string | undefined;
  prompt: string;
  promptCursor: number;
  queuedPromptCount: number;
  questionAnswer: string;
  questionOptionIndex: number;
  questionSelectedOptionIndexes: Set<number>;
  riskLevel: string;
  runVisualization: string;
  selectedMessageId: string | undefined;
  sessionId: string | undefined;
  slashCommandSelectionIndex: number;
  slashCommandSuggestions: SlashCommandInfo[];
  todoOpenCount: number;
  transcriptScrollOffset: number;
  workspaceRoot: string;
};

export function AppView(props: AppViewProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <TranscriptView
        activeStatus={props.activeStatus}
        activeAgentId={props.activeAgentId}
        activeModelId={props.activeProviderId ?? props.effectiveModelProviderId ?? "none"}
        canReadInput={props.canReadInput}
        isBusy={props.isBusy}
        messages={props.messages}
        mode={props.mode}
        planFilePath={props.planFilePath}
        queuedPromptCount={props.queuedPromptCount}
        riskLevel={props.riskLevel}
        runVisualization={props.runVisualization}
        scrollOffset={props.transcriptScrollOffset}
        selectedMessageId={props.selectedMessageId}
        sessionId={props.sessionId}
        todoOpenCount={props.todoOpenCount}
        expandedMessageIds={props.expandedMessageIds}
        workspaceRoot={props.workspaceRoot}
      />
      <OverlayArea
        pendingPermission={props.pendingPermission}
        pendingQuestion={props.pendingQuestion}
        pendingSelector={props.pendingSelector}
        questionAnswer={props.questionAnswer}
        questionOptionIndex={props.questionOptionIndex}
        questionSelectedOptionIndexes={props.questionSelectedOptionIndexes}
      />
      <CommandSuggestions
        commands={props.slashCommandSuggestions}
        selectedIndex={props.slashCommandSelectionIndex}
        hidden={
          props.pendingPermission !== undefined ||
          props.pendingQuestion !== undefined ||
          props.pendingSelector !== undefined
        }
      />
      <Composer
        prompt={props.prompt}
        cursor={props.promptCursor}
        disabled={
          props.pendingPermission !== undefined ||
          props.pendingQuestion !== undefined ||
          props.pendingSelector !== undefined
        }
      />
    </Box>
  );
}
