import { Box } from "ink";
import type { PendingPermission, PendingQuestion, PendingSelector } from "./app-controller.js";
import { CommandSuggestions } from "./command-suggestions.js";
import { Composer } from "./composer.js";
import { OverlayArea } from "./overlays.js";
import type { SlashCommandInfo } from "./slash-commands.js";
import { FooterBar, type OverlayMode, StatusBar } from "./status-bar.js";
import { getTerminalLayout, type TerminalSize, type TuiLayoutMode } from "./terminal-layout.js";
import type { TranscriptMessage } from "./transcript-types.js";
import { TranscriptView } from "./transcript-view.js";

export type AppViewProps = {
  activeStatus: string;
  activeAgentId: string;
  activeProviderId: string | undefined;
  canReadInput: boolean;
  effectiveModelProviderId: string | undefined;
  expandedMessageIds: Set<string>;
  isBusy: boolean;
  layoutMode: TuiLayoutMode;
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
  transcriptLineLimit: number | undefined;
  onTranscriptLineLimitChange: (lineLimit: number) => void;
  terminalSize: TerminalSize;
  workspaceRoot: string;
};

export function AppView(props: AppViewProps) {
  if (props.layoutMode === "fullscreen") {
    return <FullscreenAppView {...props} />;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <TranscriptView
        activeStatus={props.activeStatus}
        activeAgentId={props.activeAgentId}
        activeModelId={props.activeProviderId ?? props.effectiveModelProviderId ?? "none"}
        canReadInput={props.canReadInput}
        isBusy={props.isBusy}
        lineLimit={props.transcriptLineLimit}
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
        maxVisibleItems={props.terminalSize.height < 18 ? 2 : props.terminalSize.width < 72 ? 3 : 5}
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

function FullscreenAppView(props: AppViewProps) {
  const overlayMode = getOverlayMode(props);
  const overlayOpen = overlayMode !== undefined;
  const inputMode =
    overlayMode ?? (props.slashCommandSuggestions.length > 0 ? "suggestions" : undefined);
  const terminalLayout = getTerminalLayout(props.terminalSize);

  return (
    <Box
      flexDirection="column"
      height={props.terminalSize.height}
      width={props.terminalSize.width}
      overflow="hidden"
    >
      <StatusBar
        activeAgentId={props.activeAgentId}
        activeProviderId={props.activeProviderId}
        effectiveModelProviderId={props.effectiveModelProviderId}
        isBusy={props.isBusy}
        planFilePath={props.planFilePath}
        riskLevel={props.riskLevel}
        runVisualization={props.runVisualization}
        sessionId={props.sessionId}
        todoOpenCount={props.todoOpenCount}
        workspaceRoot={props.workspaceRoot}
        compact={terminalLayout.compact}
        queuedPromptCount={props.queuedPromptCount}
        terminalWidth={props.terminalSize.width}
      />
      <FullscreenTranscriptView compact={terminalLayout.compact} {...props} />
      <PromptArea
        composerMaxLines={terminalLayout.composerMaxLines}
        overlayOpen={overlayOpen}
        suggestionLimit={terminalLayout.suggestionLimit}
        {...props}
      />
      <FooterBar
        activeStatus={props.activeStatus}
        canReadInput={props.canReadInput}
        isBusy={props.isBusy}
        overlayMode={inputMode}
        queuedPromptCount={props.queuedPromptCount}
        scrollOffset={props.transcriptScrollOffset}
        compact={terminalLayout.compact || terminalLayout.density === "compact"}
        terminalWidth={props.terminalSize.width}
      />
    </Box>
  );
}

function getOverlayMode(
  props: Pick<AppViewProps, "pendingPermission" | "pendingQuestion" | "pendingSelector">,
): OverlayMode | undefined {
  if (props.pendingPermission) return "permission";
  if (props.pendingSelector) return "selector";
  if (props.pendingQuestion) return "question";
  return undefined;
}

function FullscreenTranscriptView(props: AppViewProps & { compact: boolean }) {
  return (
    <TranscriptView
      activeStatus={props.activeStatus}
      activeAgentId={props.activeAgentId}
      activeModelId={props.activeProviderId ?? props.effectiveModelProviderId ?? "none"}
      canReadInput={props.canReadInput}
      isBusy={props.isBusy}
      lineLimit={props.transcriptLineLimit}
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
      showChrome={false}
      fullscreen
      compact={props.compact}
      onLineLimitChange={props.onTranscriptLineLimitChange}
    />
  );
}

function PromptArea(
  props: AppViewProps & {
    composerMaxLines: number;
    overlayOpen: boolean;
    suggestionLimit: number;
  },
) {
  return (
    <Box flexDirection="column" flexShrink={0}>
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
        hidden={props.overlayOpen}
        limit={props.suggestionLimit}
        compact={props.terminalSize.width < 72}
      />
      <Composer
        prompt={props.prompt}
        cursor={props.promptCursor}
        disabled={props.overlayOpen}
        maxLines={props.composerMaxLines}
        width={props.terminalSize.width}
      />
    </Box>
  );
}
