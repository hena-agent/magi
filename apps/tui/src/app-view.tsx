import { Box } from "ink";
import type {
  DisplayMessage,
  PendingPermission,
  PendingQuestion,
  PendingSelector,
  SlashCommandInfo,
} from "./app-controller.js";
import { CommandSuggestions } from "./command-suggestions.js";
import { Composer } from "./composer.js";
import { OverlayArea } from "./overlays.js";
import { FooterBar, StatusBar } from "./status-bar.js";
import { TranscriptView } from "./transcript-view.js";

type AppViewProps = {
  activeStatus: string;
  activeAgentId: string;
  activeProviderId: string | undefined;
  canReadInput: boolean;
  effectiveModelProviderId: string | undefined;
  expandedMessageIds: Set<string>;
  isBusy: boolean;
  messages: DisplayMessage[];
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
      <StatusBar {...props} />
      <TranscriptView
        activeAgentId={props.activeAgentId}
        activeModelId={props.activeProviderId ?? props.effectiveModelProviderId ?? "none"}
        messages={props.messages}
        scrollOffset={props.transcriptScrollOffset}
        selectedMessageId={props.selectedMessageId}
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
      <FooterBar
        activeStatus={props.activeStatus}
        canReadInput={props.canReadInput}
        isBusy={props.isBusy}
        queuedPromptCount={props.queuedPromptCount}
        scrollOffset={props.transcriptScrollOffset}
      />
    </Box>
  );
}
