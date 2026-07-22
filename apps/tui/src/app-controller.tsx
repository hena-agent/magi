// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Legacy interactive controller kept behavior-preserving during app.tsx split.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Legacy interactive controller kept behavior-preserving during app.tsx split.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: Legacy interactive controller kept behavior-preserving during app.tsx split.
import { spawn } from "node:child_process";
import {
  type AgentInfo,
  type AgentTurnEvent,
  buildAgentSessionContext,
  buildAgentSystemContext,
  buildRevisionContext,
  buildSharedContextHistory,
  createTask,
  createToolCall,
  createToolSettlement,
  type EffectiveModelProvider,
  type ExecutableAgentAction,
  extractFirstDiffBlock,
  getAgent,
  getAuth,
  getDefaultAgent,
  getDefaultModelSelection,
  getLatestProposedPatch,
  getToolPermission,
  listAgents,
  listEffectiveModelProviders,
  loadModelsDevCatalog,
  loginOpenAICodexBrowser,
  loginOpenAICodexHeadless,
  MAGI_BUILD_SWITCH_REMINDER,
  mergeAgentPermission,
  planSessionMaintenance,
  refreshOpenAICodexAuth,
  removeAuth,
  runAgentTurn,
  type Session,
  type SessionEvent,
  type SessionEventType,
  selectMagiEngineCandidates,
  selectReviewLenses,
  summarizeWorkspace,
  type ToolCall,
  type ToolResult,
} from "@magi/core";
import { runVerificationCommands } from "@magi/harness";
import { useApp, useInput, useStdin } from "ink";
import { useEffect, useRef, useState } from "react";
import { createToolCallForExecutableAction } from "./agent-action-tool-call.js";
import {
  type AppControllerDependencies,
  defaultAppControllerDependencies,
} from "./app-controller-dependencies.js";
import type { AppLifecycle, AppShutdownReason } from "./app-lifecycle.js";
import { AppView } from "./app-view.js";
import { formatOutputSummary, readInputString, truncateOneLine } from "./display-format.js";
import { createSessionEventJournal } from "./draft-session.js";
import {
  readPermissionInputAction,
  readQuestionInputAction,
  readSelectorInputAction,
} from "./overlay-input.js";
import {
  addPromptHistoryEntry,
  clampPromptCursor,
  deletePreviousPromptWord as deletePreviousPromptWordState,
  deletePromptCharacter as deletePromptCharacterState,
  insertPromptText as insertPromptTextState,
  selectNextPromptHistory,
  selectPreviousPromptHistory,
  setPromptText,
} from "./prompt-state.js";
import { formatSessionEventSummary } from "./session-event-format.js";
import { sessionEventsToTranscriptMessages } from "./session-event-transcript.js";
import {
  formatSlashCommandCompletion,
  formatSlashCommandHelp,
  getSlashCommandSuggestions,
  visibleSlashCommands,
} from "./slash-commands.js";
import {
  getTranscriptLineLimit,
  readTerminalSize,
  type TerminalSize,
  type TuiLayoutMode,
} from "./terminal-layout.js";
import {
  clampTranscriptOffset,
  scrollTranscriptOffset,
  scrollTranscriptToStartOffset,
  selectTranscriptNavigation,
  toggleTranscriptExpansion,
} from "./transcript-navigation.js";
import {
  findMatchingToolPartId,
  isSameToolPart,
  upsertTranscriptPart,
} from "./transcript-parts.js";
import { getTranscriptMessageLineCount } from "./transcript-state.js";
import {
  formatToolInputTarget,
  formatToolResultSummary,
  parseJsonInput,
} from "./transcript-tool-display.js";
import type { TranscriptMessage, TranscriptPart } from "./transcript-types.js";
import { normalizeInkInputEvent } from "./tui-key-event.js";
import {
  createInitialSession,
  createSessionStartMessage,
  createSystemMessage,
  getInitialModelProviderId,
  getLatestAgentId,
  getRestoredModelProviderId,
  type InitialSessionState,
} from "./tui-session-state.js";

export type PendingPermission = {
  call: ToolCall;
  description: string;
  resolve: (allow: boolean) => void;
};

export type QuestionOption = {
  label: string;
  description: string;
};

export type QuestionPrompt = {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple: boolean;
};

export type PendingQuestion = {
  call: ToolCall;
  questions: QuestionPrompt[];
  resolve: (answer: string | undefined) => void;
};

export type SelectorItem = {
  value: string;
  label: string;
  description?: string;
};

export type PendingSelector = {
  title: string;
  subtitle?: string;
  items: SelectorItem[];
  selectedIndex: number;
  onSelect: (item: SelectorItem) => void;
};

export type TodoItem = {
  content: string;
  status: string;
  priority: string;
};

type AppendSessionEventInput = {
  type: SessionEventType;
  payload: unknown;
};

const defaultSessionTitle = "MAGI TUI session";

type QueuedPrompt = {
  content: string;
  providerId: string;
  agent: AgentInfo;
  queuedAt: string;
};

type ActiveRunProgress = {
  runId: string | undefined;
  agentId: string | undefined;
  lastStepId: string | undefined;
  steps: number;
  lastStepStatus: string | undefined;
  lastTool: string | undefined;
  thinkingStartedAtMs: number | undefined;
  toolStatuses: Map<string, string>;
};

type LiveAssistantStream = {
  text: string;
  reasoning: Map<string, string>;
  toolInputs: Map<string, { toolName: string; input: string }>;
};

type LiveToolActivity = {
  toolCounts: Map<string, number>;
  displayed: boolean;
};

export function AppController(props: {
  fullscreen?: boolean;
  targetDirectory?: string;
  dependencies?: Partial<AppControllerDependencies>;
  lifecycle?: AppLifecycle;
}) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();
  const dependencies = { ...defaultAppControllerDependencies, ...props.dependencies };
  const config = dependencies.loadConfig(
    props.targetDirectory === undefined ? undefined : { cwd: props.targetDirectory },
  );
  const task = createTask("Bootstrap MAGI TUI");
  const canReadInput = isRawModeSupported;
  const [store] = useState(() =>
    dependencies.createSessionStore({
      workspaceRoot: config.workspaceRoot,
      project: config.workspaceRoot,
      ...(props.targetDirectory === undefined ? {} : { directory: props.targetDirectory }),
    }),
  );
  const [initialSession] = useState<InitialSessionState>(() => createInitialSession(store, config));
  const [sessionJournal] = useState(() =>
    createSessionEventJournal({
      store,
      ...(initialSession.session === undefined ? {} : { initialSession: initialSession.session }),
    }),
  );
  const providerSessionIdRef = useRef(initialSession.session?.id ?? crypto.randomUUID());
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const steeringInputsRef = useRef<string[]>([]);
  const interruptionRequestedRef = useRef(false);
  const foregroundAbortControllerRef = useRef<AbortController | undefined>(undefined);
  const foregroundCompletionRef = useRef<Promise<void> | undefined>(undefined);
  const backgroundOperationsRef = useRef(
    new Map<string, { controller: AbortController; promise: Promise<void> }>(),
  );
  const pendingPermissionRef = useRef<PendingPermission | undefined>(undefined);
  const pendingQuestionRef = useRef<PendingQuestion | undefined>(undefined);
  const shutdownPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const storeClosedRef = useRef(false);
  const mountedRef = useRef(true);
  const busyDepthRef = useRef(0);
  const activeRunProgressRef = useRef<ActiveRunProgress>(createEmptyRunProgress());
  const liveAssistantStreamsRef = useRef<Map<string, LiveAssistantStream>>(new Map());
  const liveToolActivitiesRef = useRef<Map<string, LiveToolActivity>>(new Map());
  const [session, setSession] = useState<Session | undefined>(initialSession.session);
  const [activeAgent, setActiveAgent] = useState<AgentInfo>(() => {
    const events = initialSession.session ? store.listEvents(initialSession.session.id) : [];
    return getAgent(getLatestAgentId(events)) ?? getDefaultAgent();
  });
  const [activeProviderId, setActiveProviderId] = useState<string | undefined>(() =>
    getInitialModelProviderId(store, initialSession, config),
  );
  const effectiveModelProviders = getEffectiveProviders();
  const [prompt, setPrompt] = useState("");
  const [promptCursor, setPromptCursor] = useState(0);
  const promptStateRef = useRef({ prompt: "", cursor: 0 });
  const promptHistoryRef = useRef<string[]>([]);
  const promptHistoryIndexRef = useRef<number | undefined>(undefined);
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0);
  const [messages, setMessages] = useState<TranscriptMessage[]>(() => [
    createSessionStartMessage(initialSession),
    ...(initialSession.session === undefined
      ? []
      : sessionEventsToTranscriptMessages(store.listEvents(initialSession.session.id), 30)),
  ]);
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>();
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [terminalSize, setTerminalSize] = useState<TerminalSize>(() => readTerminalSize());
  const [measuredTranscriptLineLimit, setMeasuredTranscriptLineLimit] = useState<number>();
  const [activeStatus, setActiveStatus] = useState("Ready");
  const [runVisualization, setRunVisualization] = useState("idle");
  const [pendingPermission, setPendingPermission] = useState<PendingPermission>();
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion>();
  const [pendingSelector, setPendingSelector] = useState<PendingSelector>();
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [questionOptionIndex, setQuestionOptionIndex] = useState(0);
  const [questionSelectedOptionIndexes, setQuestionSelectedOptionIndexes] = useState<Set<number>>(
    () => new Set(),
  );
  const [todos, setTodos] = useState<TodoItem[]>(() =>
    getLatestTodos(initialSession.session ? store.listEvents(initialSession.session.id) : []),
  );
  const [busyDepth, setBusyDepth] = useState(0);
  const isBusy = busyDepth > 0;
  const slashCommandSuggestions =
    pendingPermission || pendingQuestion || pendingSelector
      ? []
      : getSlashCommandSuggestions(prompt);
  const layoutMode: TuiLayoutMode = props.fullscreen === true ? "fullscreen" : "default";
  const fallbackTranscriptLineLimit = getTranscriptLineLimit({
    mode: layoutMode,
    terminalHeight: terminalSize.height,
    hasOverlay: Boolean(pendingPermission || pendingQuestion || pendingSelector),
    suggestionCount: slashCommandSuggestions.length,
  });
  const transcriptLineLimit =
    layoutMode === "fullscreen"
      ? (measuredTranscriptLineLimit ?? fallbackTranscriptLineLimit)
      : undefined;

  useEffect(() => {
    const cursor = clampPromptCursor(prompt, promptStateRef.current.cursor);
    promptStateRef.current = { prompt, cursor };
    setPromptCursor(cursor);
  }, [prompt]);

  useEffect(() => {
    setTranscriptScrollOffset((offset) =>
      clampTranscriptOffset({
        messages,
        expandedIds: expandedMessageIds,
        offset,
        lineLimit: transcriptLineLimit,
      }),
    );
    if (selectedMessageId === undefined && messages.length > 0) {
      setSelectedMessageId(messages.at(-1)?.id);
    }
  }, [messages, selectedMessageId, expandedMessageIds, transcriptLineLimit]);

  useEffect(() => {
    if (layoutMode !== "fullscreen") return;

    const handleResize = () => setTerminalSize(readTerminalSize());
    process.stdout.on("resize", handleResize);
    return () => {
      process.stdout.off("resize", handleResize);
    };
  }, [layoutMode]);

  useEffect(() => {
    if (!isBusy) return;

    const interval = setInterval(() => {
      const progress = activeRunProgressRef.current;
      if (progress.thinkingStartedAtMs === undefined) return;

      setActiveStatus(formatThinkingStatus(progress));
      setRunVisualization(formatRunVisualization(progress));
    }, 1000);

    return () => clearInterval(interval);
  }, [isBusy]);

  function getEffectiveProviders(): EffectiveModelProvider[] {
    return listEffectiveModelProviders({
      configProviders: config.modelProviders,
      workspaceRoot: config.workspaceRoot,
    });
  }

  function getPlanFilePath(): string {
    return `.magi/plans/${sessionJournal.getSession()?.id ?? providerSessionIdRef.current}.md`;
  }

  function updateMeasuredTranscriptLineLimit(lineLimit: number): void {
    setMeasuredTranscriptLineLimit((current) => (current === lineLimit ? current : lineLimit));
  }

  function isPlanFilePath(filePath: string): boolean {
    return filePath === getPlanFilePath();
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: teardown reads current operation refs and must register once.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      foregroundAbortControllerRef.current?.abort();
      for (const operation of backgroundOperationsRef.current.values()) {
        operation.controller.abort();
      }
      closeStore();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: lifecycle registration is keyed only by the external coordinator.
  useEffect(() => props.lifecycle?.registerShutdown(shutdownApp), [props.lifecycle]);

  useInput(
    (input, key) => {
      const event = normalizeInkInputEvent(input, key);

      if (event.name === "c" && event.ctrl) {
        handleCtrlC();
        return;
      }

      if (pendingPermission) {
        handlePermissionInputAction(readPermissionInputAction(event));
        return;
      }

      if (pendingSelector) {
        handleSelectorInputAction(
          readSelectorInputAction({
            event,
            selectedIndex: pendingSelector.selectedIndex,
            itemCount: pendingSelector.items.length,
          }),
        );
        return;
      }

      if (pendingQuestion) {
        const activeQuestion = pendingQuestion.questions[0];
        handleQuestionInputAction(
          readQuestionInputAction({
            event,
            activeQuestion,
            optionIndex: questionOptionIndex,
            selectedOptionIndexes: questionSelectedOptionIndexes,
            answer: questionAnswer,
          }),
        );
        return;
      }

      if (event.input === "q" && promptStateRef.current.prompt.length === 0) {
        void requestExit();
        return;
      }

      if (event.name === "escape") {
        requestInterruption();
        return;
      }

      if (event.name === "tab" && slashCommandSuggestions.length > 0) {
        const selected = slashCommandSuggestions[slashSelectionIndex] ?? slashCommandSuggestions[0];
        if (selected) {
          setPromptWithCursor(formatSlashCommandCompletion(selected));
        }
        return;
      }

      if (event.name === "up") {
        if (slashCommandSuggestions.length > 0) {
          setSlashSelectionIndex((index) =>
            index <= 0 ? slashCommandSuggestions.length - 1 : index - 1,
          );
          return;
        }
        showPreviousPromptHistory();
        return;
      }

      if (event.name === "down") {
        if (slashCommandSuggestions.length > 0) {
          setSlashSelectionIndex((index) => (index + 1) % slashCommandSuggestions.length);
          return;
        }
        showNextPromptHistory();
        return;
      }

      if (event.name === "pageup") {
        scrollTranscript(8);
        return;
      }

      if (event.name === "pagedown") {
        scrollTranscript(-8);
        return;
      }

      if (event.name === "home") {
        scrollTranscriptToStart();
        return;
      }

      if (event.name === "end") {
        scrollTranscriptToEnd();
        return;
      }

      if (promptStateRef.current.prompt.length === 0 && event.input === "k") {
        selectTranscriptMessage(-1);
        return;
      }

      if (promptStateRef.current.prompt.length === 0 && event.input === "j") {
        selectTranscriptMessage(1);
        return;
      }

      if (
        promptStateRef.current.prompt.length === 0 &&
        (event.input === " " || event.name === "return")
      ) {
        toggleSelectedMessageExpansion();
        return;
      }

      if (event.name === "left" || (event.name === "b" && event.ctrl)) {
        setPromptCursorPosition(promptStateRef.current.cursor - 1);
        return;
      }

      if (event.name === "right" || (event.name === "f" && event.ctrl)) {
        setPromptCursorPosition(promptStateRef.current.cursor + 1);
        return;
      }

      if (event.name === "a" && event.ctrl) {
        setPromptCursorPosition(0);
        return;
      }

      if (event.name === "e" && event.ctrl) {
        setPromptCursorPosition(promptStateRef.current.prompt.length);
        return;
      }

      if (event.name === "u" && event.ctrl) {
        setPromptWithCursor("");
        promptHistoryIndexRef.current = undefined;
        return;
      }

      if (event.name === "w" && event.ctrl) {
        deletePreviousPromptWord();
        return;
      }

      if (event.name === "return") {
        if (slashCommandSuggestions.length > 0) {
          const selected =
            slashCommandSuggestions[slashSelectionIndex] ?? slashCommandSuggestions[0];
          if (selected) {
            setPromptWithCursor(formatSlashCommandCompletion(selected));
          }
          return;
        }

        const content = promptStateRef.current.prompt.trim();

        if (content.length > 0) {
          setPromptWithCursor("");
          addPromptHistory(content);
          void handleSubmittedPrompt(content);
        }

        return;
      }

      if (event.name === "backspace" || event.name === "delete") {
        deletePromptCharacter();
        return;
      }

      if (event.input.length > 0) {
        insertPromptText(event.input);
      }
    },
    {
      isActive: canReadInput,
    },
  );

  function handlePermissionInputAction(action: ReturnType<typeof readPermissionInputAction>): void {
    if (action.type === "resolve") {
      void resolvePermission(action.allow);
    }
  }

  function handleSelectorInputAction(action: ReturnType<typeof readSelectorInputAction>): void {
    if (action.type === "cancel") {
      setPendingSelector(undefined);
      return;
    }

    if (action.type === "move") {
      setPendingSelector((current) =>
        current ? { ...current, selectedIndex: action.selectedIndex } : current,
      );
      return;
    }

    if (action.type === "select" && pendingSelector) {
      const selectedItem = pendingSelector.items[action.selectedIndex];
      setPendingSelector(undefined);
      if (selectedItem) {
        pendingSelector.onSelect(selectedItem);
      }
    }
  }

  function handleQuestionInputAction(action: ReturnType<typeof readQuestionInputAction>): void {
    if (action.type === "cancel") {
      resolveQuestion(undefined);
      return;
    }

    if (action.type === "move") {
      setQuestionOptionIndex(action.optionIndex);
      return;
    }

    if (action.type === "set-selection") {
      setQuestionSelectedOptionIndexes(action.selectedOptionIndexes);
      setQuestionAnswer(action.answer);
      return;
    }

    if (action.type === "submit") {
      resolveQuestion(readPendingQuestionAnswer());
      return;
    }

    if (action.type === "set-answer") {
      setQuestionAnswer(action.answer);
      setQuestionSelectedOptionIndexes(action.selectedOptionIndexes);
    }
  }

  function setPromptWithCursor(nextPrompt: string, nextCursor: number = nextPrompt.length): void {
    const next = setPromptText(nextPrompt, nextCursor);
    promptStateRef.current = next;
    setPrompt(next.prompt);
    setPromptCursor(next.cursor);
    setSlashSelectionIndex(0);
  }

  function insertPromptText(text: string): void {
    const next = insertPromptTextState(promptStateRef.current, text);
    setPromptWithCursor(next.prompt, next.cursor);
    promptHistoryIndexRef.current = undefined;
  }

  function deletePromptCharacter(): void {
    const next = deletePromptCharacterState(promptStateRef.current);
    setPromptWithCursor(next.prompt, next.cursor);
    promptHistoryIndexRef.current = undefined;
  }

  function deletePreviousPromptWord(): void {
    const next = deletePreviousPromptWordState(promptStateRef.current);
    setPromptWithCursor(next.prompt, next.cursor);
    promptHistoryIndexRef.current = undefined;
  }

  function setPromptCursorPosition(cursor: number): void {
    setPromptWithCursor(promptStateRef.current.prompt, cursor);
  }

  function addPromptHistory(content: string): void {
    promptHistoryRef.current = addPromptHistoryEntry(promptHistoryRef.current, content);
    promptHistoryIndexRef.current = undefined;
  }

  function showPreviousPromptHistory(): void {
    const selection = selectPreviousPromptHistory(
      promptHistoryRef.current,
      promptHistoryIndexRef.current,
    );
    if (!selection) return;

    promptHistoryIndexRef.current = selection.index;
    setPromptWithCursor(selection.prompt);
  }

  function showNextPromptHistory(): void {
    const selection = selectNextPromptHistory(
      promptHistoryRef.current,
      promptHistoryIndexRef.current,
    );
    if (!selection) return;

    promptHistoryIndexRef.current = selection.index;
    setPromptWithCursor(selection.prompt);
  }

  function scrollTranscript(delta: number): void {
    setTranscriptScrollOffset((offset) =>
      scrollTranscriptOffset({
        messages,
        expandedIds: expandedMessageIds,
        offset,
        delta,
        lineLimit: transcriptLineLimit,
      }),
    );
  }

  function scrollTranscriptToStart(): void {
    setTranscriptScrollOffset(
      scrollTranscriptToStartOffset({
        messages,
        expandedIds: expandedMessageIds,
        lineLimit: transcriptLineLimit,
      }),
    );
  }

  function scrollTranscriptToEnd(): void {
    setTranscriptScrollOffset(0);
  }

  function selectTranscriptMessage(direction: number): void {
    const next = selectTranscriptNavigation({
      messages,
      expandedIds: expandedMessageIds,
      selectedId: selectedMessageId,
      scrollOffset: transcriptScrollOffset,
      direction,
      lineLimit: transcriptLineLimit,
    });
    if (next.selectedId === selectedMessageId && next.scrollOffset === transcriptScrollOffset)
      return;

    setSelectedMessageId(next.selectedId);
    setTranscriptScrollOffset(next.scrollOffset);
  }

  function toggleSelectedMessageExpansion(): void {
    setExpandedMessageIds((expandedIds) => {
      const next = toggleTranscriptExpansion({
        messages,
        expandedIds,
        selectedId: selectedMessageId,
        scrollOffset: transcriptScrollOffset,
        lineLimit: transcriptLineLimit,
      });
      setTranscriptScrollOffset(next.scrollOffset);
      return next.expandedIds;
    });
  }

  async function handleSubmittedPrompt(content: string): Promise<void> {
    if (content.startsWith("/")) {
      await handleCommand(content);
      return;
    }

    if (busyDepthRef.current > 0) {
      const queuedAt = new Date().toISOString();
      const queuedPrompt = {
        content,
        providerId: activeProviderId ?? "",
        agent: activeAgent,
        queuedAt,
      };
      queuedPromptsRef.current = [...queuedPromptsRef.current, queuedPrompt];
      appendSessionEvent({
        type: "queued_user_input",
        payload: {
          content,
          agentId: activeAgent.id,
          providerId: activeProviderId,
          mode: "queued",
          queuedAt,
        },
      });
      addMessage(`Queued prompt #${queuedPromptsRef.current.length}: ${truncateOneLine(content)}`);
      return;
    }

    await submitAgentPrompt(content, activeAgent, activeProviderId);
  }

  async function handleCommand(content: string): Promise<void> {
    const [command = "", ...args] = content.slice(1).split(" ");

    if (command === "help") {
      addMessage(formatSlashCommandHelp(visibleSlashCommands));
      return;
    }

    if (command === "mode") {
      showModeStatus();
      return;
    }

    if (command === "verify") {
      if (
        !requirePersistedSession(
          "Run a normal prompt first, or /resume an existing session, before running /verify.",
        )
      ) {
        return;
      }

      await runVerification(args.join(" ").trim());
      return;
    }

    if (command === "revise") {
      if (
        !requirePersistedSession(
          "Run a normal prompt first, or /resume an existing session, before running /revise.",
        )
      ) {
        return;
      }

      await reviseFromVerificationFailures();
      return;
    }

    if (command === "apply_last_patch") {
      if (
        !requirePersistedSession(
          "Run a normal prompt first, or /resume an existing session, before applying patches.",
        )
      ) {
        return;
      }

      await applyLastProposedPatch();
      return;
    }

    if (command === "summary") {
      if (
        !requirePersistedSession(
          "Run a normal prompt first, or /resume an existing session, before running /summary.",
        )
      ) {
        return;
      }

      await runSummary();
      return;
    }

    if (command === "sessions") {
      showSessionSelector(args[0] === "all" || args[0] === "--all");
      return;
    }

    if (command === "resume") {
      resumeSession(args.join(" ").trim());
      return;
    }

    if (command === "new") {
      createNewSession(args.join(" ").trim());
      return;
    }

    if (command === "rename") {
      renameCurrentSession(args.join(" ").trim());
      return;
    }

    if (command === "history") {
      showHistory(args[0]);
      return;
    }

    if (command === "auth") {
      await handleAuthCommand(args);
      return;
    }

    if (command === "model") {
      handleModelCommand(args);
      return;
    }

    if (command === "agent") {
      showAgentSelectorOrSwitch(args.join(" ").trim());
      return;
    }

    if (command === "plan") {
      await switchAgentAndMaybeRun("plan", args.join(" ").trim());
      return;
    }

    if (command === "build") {
      await switchAgentAndMaybeRun("build", args.join(" ").trim());
      return;
    }

    if (command === "queue") {
      showQueuedPrompts();
      return;
    }

    if (command === "clear_queue") {
      queuedPromptsRef.current = [];
      addMessage("Cleared queued prompts.");
      return;
    }

    if (command === "steer") {
      addSteeringInput(args.join(" ").trim());
      return;
    }

    if (command === "interrupt") {
      requestInterruption();
      return;
    }

    if (command === "maintain_sessions") {
      maintainRecentSessions();
      return;
    }

    if (command === "session_cleanup_candidates") {
      showSessionCleanupCandidates();
      return;
    }

    if (command === "magi_preview") {
      if (
        !requirePersistedSession(
          "Run a normal prompt first, or /resume an existing session, before running /magi_preview.",
        )
      ) {
        return;
      }

      await previewMagiContext();
      return;
    }

    addMessage(`Unknown command: /${command}. Type /help for available commands.`);
  }

  async function submitAgentPrompt(
    content: string,
    agent: AgentInfo,
    providerId: string | undefined,
  ): Promise<void> {
    const userEvent = appendSessionEvent({
      type: "user_message",
      payload: { content, agentId: agent.id, providerId },
    });
    addUserMessage(content, `${userEvent.id}-user`, agent, providerId);

    await runSingleEngineAgentTurn(content, agent, providerId);
  }

  async function runSingleEngineAgentTurn(
    content: string,
    agent: AgentInfo,
    providerId: string | undefined,
  ): Promise<void> {
    const abortController = new AbortController();
    const completion = createCompletion();
    foregroundAbortControllerRef.current = abortController;
    foregroundCompletionRef.current = completion.promise;
    beginBusy();
    interruptionRequestedRef.current = false;
    let interrupted = false;

    try {
      const adapter = dependencies.createPrimaryModelAdapter({
        ...config,
        selectedProviderId: providerId,
        sessionId: providerSessionIdRef.current,
      });
      const steeringInputs = steeringInputsRef.current;
      steeringInputsRef.current = [];
      const effectiveContent =
        steeringInputs.length === 0
          ? content
          : `${content}\n\nSteering input for this run:\n${steeringInputs.map((input) => `- ${input}`).join("\n")}`;
      const sessionContext = buildAgentSessionContext({
        events: getCurrentSessionEvents().slice(0, -1),
      });
      const systemContext = buildAgentSystemContext({ workspaceRoot: config.workspaceRoot });
      const result = await runAgentTurn({
        engine: adapter,
        agent,
        userMessage: effectiveContent,
        systemContext,
        sessionContext,
        maxIterations: config.agent.maxIterations,
        signal: abortController.signal,
        shouldInterrupt() {
          return interruptionRequestedRef.current;
        },
        onEvent(event) {
          appendAgentTurnEvent(event, agent);
        },
        async executeAction(action) {
          return await executeAgentAction(action, agent, providerId);
        },
      });
      interrupted = result.status === "interrupted";
      if (interrupted) {
        setActiveStatus("Interrupted");
        addMessage("Agent run interrupted.");
        return;
      }
      const progress = activeRunProgressRef.current;
      const event = appendSessionEvent({
        type: "assistant_message",
        payload: {
          content: result.finalText,
          agentId: agent.id,
          providerId: adapter.provider?.id ?? providerId,
          model: adapter.provider?.model,
          agentTurn: true,
          status: result.status,
          ...(progress.runId === undefined ? {} : { runId: progress.runId }),
          ...(progress.lastStepId === undefined ? {} : { stepId: progress.lastStepId }),
        },
      });
      persistDraftSessionIfNeeded(content, result.finalText);
      completeLatestAssistantMessage(event.id, truncate(result.finalText), agent, {
        providerId: adapter.provider?.id ?? providerId,
        model: adapter.provider?.model,
      });
    } catch (error) {
      if (isAbortError(error, abortController.signal)) {
        interrupted = true;
        setActiveStatus("Interrupted");
        addMessage("Agent run interrupted.");
        return;
      }
      if (!sessionJournal.getSession()) {
        sessionJournal.resetToDraft();
      }
      addMessage(`Agent error: ${formatError(error)}`);
    } finally {
      if (foregroundAbortControllerRef.current === abortController) {
        foregroundAbortControllerRef.current = undefined;
        foregroundCompletionRef.current = undefined;
      }
      completion.resolve();
      endBusy();
      if (!interrupted) void drainQueuedPrompts();
    }
  }

  async function executeAgentAction(
    action: ExecutableAgentAction,
    agent: AgentInfo,
    providerId: string | undefined = activeProviderId,
  ): Promise<string> {
    const actionToolCall = (name: Parameters<typeof createToolCall>[0], input: unknown) =>
      createToolCall(name, input, action.toolCallId);

    switch (action.type) {
      case "read":
        return await executeToolAction(actionToolCall("read", { path: action.path }), agent);
      case "glob":
        return await executeToolAction(actionToolCall("glob", { pattern: action.pattern }), agent);
      case "grep":
        return await executeToolAction(
          actionToolCall("grep", {
            pattern: action.pattern,
            ...(action.include === undefined ? {} : { include: action.include }),
          }),
          agent,
        );
      case "edit":
        if (agent.id === "plan" && isPlanFilePath(action.filePath)) {
          return toolResultToObservation(
            await executeToolCall(
              actionToolCall("edit", {
                filePath: action.filePath,
                oldString: action.oldString,
                newString: action.newString,
                ...(action.replaceAll === undefined ? {} : { replaceAll: action.replaceAll }),
              }),
              agent,
            ),
          );
        }

        return await executeToolAction(
          actionToolCall("edit", {
            filePath: action.filePath,
            oldString: action.oldString,
            newString: action.newString,
            ...(action.replaceAll === undefined ? {} : { replaceAll: action.replaceAll }),
          }),
          agent,
        );
      case "write":
        if (agent.id === "plan" && isPlanFilePath(action.filePath)) {
          return toolResultToObservation(
            await executeToolCall(
              actionToolCall("write", { filePath: action.filePath, content: action.content }),
              agent,
            ),
          );
        }

        return await executeToolAction(
          actionToolCall("write", { filePath: action.filePath, content: action.content }),
          agent,
        );
      case "apply_patch":
        return await executeToolAction(
          actionToolCall("apply_patch", { patchText: action.patchText }),
          agent,
        );
      case "webfetch":
        return await executeToolAction(
          actionToolCall("webfetch", {
            url: action.url,
            ...(action.format === undefined ? {} : { format: action.format }),
            ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
          }),
          agent,
        );
      case "websearch":
        return await executeToolAction(
          actionToolCall("websearch", {
            query: action.query,
            ...(action.providerId === undefined ? {} : { providerId: action.providerId }),
            ...(action.limit === undefined ? {} : { limit: action.limit }),
            ...(action.searchType === undefined ? {} : { type: action.searchType }),
            ...(action.livecrawl === undefined ? {} : { livecrawl: action.livecrawl }),
            ...(action.contextMaxCharacters === undefined
              ? {}
              : { contextMaxCharacters: action.contextMaxCharacters }),
          }),
          agent,
        );
      case "todowrite":
        return await executeToolAction(actionToolCall("todowrite", { todos: action.todos }), agent);
      case "question":
        return await executeToolAction(
          actionToolCall("question", { questions: action.questions }),
          agent,
        );
      case "skill":
        return await executeToolAction(actionToolCall("skill", { name: action.name }), agent);
      case "lsp_symbols":
        return await executeToolAction(
          actionToolCall("lsp_symbols", { filePath: action.filePath }),
          agent,
        );
      case "lsp_definition":
      case "lsp_references":
      case "lsp_hover":
      case "lsp_call_hierarchy":
        return await executeToolAction(
          actionToolCall(action.type, {
            filePath: action.filePath,
            line: action.line,
            character: action.character,
            ...(action.type === "lsp_call_hierarchy" && action.direction !== undefined
              ? { direction: action.direction }
              : {}),
          }),
          agent,
        );
      case "task":
        return action.background === true
          ? runBackgroundTask(action, agent, providerId)
          : await runForegroundTask(action, agent, providerId);
      case "plan_exit":
        return await runPlanExit(agent);
      case "verify":
        return await runAgentVerification(action, agent);
      case "propose_patch": {
        const event = appendSessionEvent({
          type: "proposed_patch",
          payload: { source: "agent_turn", patch: action.patch, summary: action.summary },
        });
        addMessage(
          `Proposed patch saved as event #${event.sequence}. Requesting write approval...`,
        );
        return await executeToolAction(
          actionToolCall("apply_patch", { patch: action.patch }),
          agent,
        );
      }
      case "invalid_tool":
        return `Invalid native tool call: ${action.toolName}\nReason: ${action.reason}`;
    }
  }

  async function runPlanExit(agent: AgentInfo): Promise<string> {
    if (agent.id !== "plan") {
      return "plan_exit ignored: active agent is not plan.";
    }

    const planPath = getPlanFilePath();
    const answer = await new Promise<string | undefined>((resolve) => {
      setQuestionAnswer("");
      updatePendingQuestion({
        call: createToolCall("question", { source: "plan_exit" }),
        questions: [
          {
            question: `Plan at ${planPath} is complete. Would you like to switch to the build agent and start implementing?`,
            header: "Build Agent",
            multiple: false,
            options: [
              {
                label: "Yes",
                description: "Switch to build agent and start implementing the plan",
              },
              { label: "No", description: "Stay with plan agent to continue refining the plan" },
            ],
          },
        ],
        resolve,
      });
    });
    updatePendingQuestion(undefined);
    const accepted = answer?.trim() === "1" || answer?.toLowerCase() === "yes";
    appendSessionEvent({
      type: "plan_exit",
      payload: { planPath, accepted, answer: answer ?? "Unanswered" },
    });

    if (accepted) {
      const build = getAgent("build");
      if (build) {
        appendSessionEvent({
          type: "agent_switch",
          payload: { agentId: build.id, previousAgentId: agent.id, source: "plan_exit" },
        });
        setActiveAgent(build);
      }
      return [
        "Plan approved. Switched agent: build.",
        MAGI_BUILD_SWITCH_REMINDER,
        `Plan file: ${planPath}`,
      ].join("\n\n");
    }

    return `Plan remains active. Continue refining ${planPath}.`;
  }

  async function runForegroundTask(
    action: Extract<ExecutableAgentAction, { type: "task" }>,
    parentAgent: AgentInfo,
    providerId: string | undefined,
  ): Promise<string> {
    if (parentAgent.id === "plan" && action.subagent_type !== "explore") {
      return "task denied: plan agent may only launch explore subagents.";
    }

    const subagent = getAgent(action.subagent_type);

    if (!subagent || subagent.mode === "primary") {
      return `task failed: unknown subagent type ${action.subagent_type}`;
    }

    addMessage(`task: ${action.description} (${subagent.id})`);

    const adapter = dependencies.createPrimaryModelAdapter({
      ...config,
      selectedProviderId: providerId,
      sessionId: providerSessionIdRef.current,
    });
    const sessionContext = buildAgentSessionContext({ events: getCurrentSessionEvents() });
    const systemContext = buildAgentSystemContext({ workspaceRoot: config.workspaceRoot });
    const result = await runAgentTurn({
      engine: adapter,
      agent: subagent,
      userMessage: action.prompt,
      systemContext,
      sessionContext,
      signal: foregroundAbortControllerRef.current?.signal,
      shouldInterrupt() {
        return interruptionRequestedRef.current;
      },
      onEvent(event) {
        appendAgentTurnEvent(event, subagent);
      },
      async executeAction(childAction) {
        if (childAction.type === "task") {
          return "Nested task calls are disabled for foreground subagents.";
        }

        return await executeAgentAction(childAction, subagent, providerId);
      },
    });

    return [
      `<task id="${action.task_id ?? crypto.randomUUID()}" state="${result.status === "completed" ? "completed" : "error"}">`,
      `<summary>${action.description}</summary>`,
      result.finalText,
      "</task>",
    ].join("\n");
  }

  function runBackgroundTask(
    action: Extract<ExecutableAgentAction, { type: "task" }>,
    parentAgent: AgentInfo,
    providerId: string | undefined,
  ): string {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      return "task denied: background tasks require a saved session. Run a normal prompt first or use foreground task mode.";
    }

    if (parentAgent.id === "plan" && action.subagent_type !== "explore") {
      return "task denied: plan agent may only launch explore subagents.";
    }

    const subagent = getAgent(action.subagent_type);

    if (!subagent || subagent.mode === "primary") {
      return `task failed: unknown subagent type ${action.subagent_type}`;
    }

    const taskId = action.task_id ?? crypto.randomUUID();
    const targetSessionId = currentSession.id;
    const startedAt = new Date().toISOString();
    store.appendEvent({
      sessionId: targetSessionId,
      type: "task_update",
      payload: {
        taskId,
        status: "started",
        description: action.description,
        subagentId: subagent.id,
        parentAgentId: parentAgent.id,
        providerId,
        startedAt,
      },
    });
    addMessage(`task background started: ${action.description} (${subagent.id}, ${taskId})`);

    const controller = new AbortController();
    const promise = runBackgroundTaskToCompletion({
      action,
      parentAgent,
      providerId,
      subagent,
      targetSessionId,
      taskId,
      startedAt,
      signal: controller.signal,
    });
    backgroundOperationsRef.current.set(taskId, { controller, promise });
    void promise.finally(() => backgroundOperationsRef.current.delete(taskId));

    return [
      `<task id="${taskId}" state="running" background="true">`,
      `<summary>${action.description}</summary>`,
      "Background task started. Its completion will be recorded in session history.",
      "</task>",
    ].join("\n");
  }

  async function runBackgroundTaskToCompletion(input: {
    action: Extract<ExecutableAgentAction, { type: "task" }>;
    parentAgent: AgentInfo;
    providerId: string | undefined;
    subagent: AgentInfo;
    targetSessionId: string;
    taskId: string;
    startedAt: string;
    signal: AbortSignal;
  }): Promise<void> {
    try {
      const adapter = dependencies.createPrimaryModelAdapter({
        ...config,
        selectedProviderId: input.providerId,
        sessionId: input.targetSessionId,
      });
      const sessionContext = buildAgentSessionContext({
        events: store.listEvents(input.targetSessionId),
      });
      const systemContext = buildAgentSystemContext({ workspaceRoot: config.workspaceRoot });
      const result = await runAgentTurn({
        engine: adapter,
        agent: input.subagent,
        userMessage: input.action.prompt,
        systemContext,
        sessionContext,
        signal: input.signal,
        shouldInterrupt() {
          return input.signal.aborted;
        },
        onEvent(event) {
          appendAgentTurnEventToSession(event, input.subagent, input.targetSessionId, input.taskId);
        },
        async executeAction(childAction) {
          if (childAction.type === "task") {
            return "Nested task calls are disabled for background subagents.";
          }

          return await executeBackgroundAgentAction(
            childAction,
            input.subagent,
            input.targetSessionId,
            input.signal,
          );
        },
      });
      if (!mountedRef.current) return;
      const endedAt = new Date().toISOString();
      store.appendEvent({
        sessionId: input.targetSessionId,
        type: "task_update",
        payload: {
          taskId: input.taskId,
          status:
            result.status === "completed"
              ? "completed"
              : result.status === "interrupted"
                ? "interrupted"
                : "failed",
          description: input.action.description,
          subagentId: input.subagent.id,
          parentAgentId: input.parentAgent.id,
          startedAt: input.startedAt,
          endedAt,
          finalText: result.finalText,
        },
      });
      addMessageForSession(
        input.targetSessionId,
        `task background ${result.status}: ${input.action.description} (${input.taskId})`,
      );
    } catch (error) {
      if (!mountedRef.current) return;
      const endedAt = new Date().toISOString();
      const interrupted = isAbortError(error, input.signal);
      store.appendEvent({
        sessionId: input.targetSessionId,
        type: "task_update",
        payload: {
          taskId: input.taskId,
          status: interrupted ? "interrupted" : "failed",
          description: input.action.description,
          subagentId: input.subagent.id,
          parentAgentId: input.parentAgent.id,
          startedAt: input.startedAt,
          endedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      addMessageForSession(
        input.targetSessionId,
        `task background failed: ${input.action.description} (${input.taskId})`,
      );
    }
  }

  async function executeBackgroundAgentAction(
    action: ExecutableAgentAction,
    agent: AgentInfo,
    targetSessionId: string,
    signal: AbortSignal,
  ): Promise<string> {
    const call = createToolCallForExecutableAction(action, {
      verificationCommands: config.verificationCommands,
    });

    if (!call) {
      return `${action.type} is not available in background tasks.`;
    }

    const result = await runBackgroundToolCall(call, agent, targetSessionId, signal);

    return result ? toolResultToObservation(result) : `${call.name} did not run.`;
  }

  async function runBackgroundToolCall(
    call: ToolCall,
    agent: AgentInfo,
    targetSessionId: string,
    signal: AbortSignal,
  ): Promise<ToolResult | undefined> {
    const permission = getToolPermission(call.name);
    const policy = mergeAgentPermission(agent, config.permissions)[permission];
    store.appendEvent({
      sessionId: targetSessionId,
      type: "tool_settlement",
      payload: { ...createToolSettlement({ call, status: "pending" }), agentId: agent.id },
    });

    if (policy !== "allow") {
      store.appendEvent({
        sessionId: targetSessionId,
        type: "permission_decision",
        payload: { toolCallId: call.id, action: permission, decision: "deny", background: true },
      });
      store.appendEvent({
        sessionId: targetSessionId,
        type: "tool_settlement",
        payload: {
          ...createToolSettlement({ call, status: "denied", endedAt: new Date().toISOString() }),
          agentId: agent.id,
        },
      });

      return;
    }

    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    store.appendEvent({ sessionId: targetSessionId, type: "tool_call", payload: call });
    store.appendEvent({
      sessionId: targetSessionId,
      type: "tool_settlement",
      payload: {
        ...createToolSettlement({ call, status: "running", startedAt }),
        agentId: agent.id,
      },
    });

    let result: ToolResult;
    try {
      result = await dependencies.runTool(call, { workspaceRoot: config.workspaceRoot, signal });
    } catch (error) {
      if (!isAbortError(error, signal)) throw error;
      if (mountedRef.current) {
        store.appendEvent({
          sessionId: targetSessionId,
          type: "tool_settlement",
          payload: {
            ...createToolSettlement({
              call,
              status: "interrupted",
              startedAt,
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - startedAtMs,
            }),
            agentId: agent.id,
          },
        });
      }
      throw error;
    }
    if (!mountedRef.current) return result;
    if (result.ok && call.name === "todowrite") {
      const nextTodos = readTodosFromToolInput(call.input);
      store.appendEvent({
        sessionId: targetSessionId,
        type: "todo_update",
        payload: { todos: nextTodos, background: true },
      });
      if (sessionJournal.getSession()?.id === targetSessionId) {
        setTodos(nextTodos);
      }
    }
    store.appendEvent({ sessionId: targetSessionId, type: "tool_result", payload: result });
    store.appendEvent({
      sessionId: targetSessionId,
      type: "tool_settlement",
      payload: {
        ...createToolSettlement({
          call,
          status: result.ok ? "succeeded" : "failed",
          startedAt,
          endedAt: new Date().toISOString(),
          durationMs: Date.now() - startedAtMs,
          result,
        }),
        agentId: agent.id,
      },
    });
    addMessageForSession(targetSessionId, formatToolResultMessage(result, call.input));

    return result;
  }

  async function executeToolAction(
    call: ToolCall,
    agent: AgentInfo = activeAgent,
  ): Promise<string> {
    const result = await runToolWithPermission(call, agent);

    if (!result) {
      return `${call.name} did not run.`;
    }

    return toolResultToObservation(result);
  }

  function toolResultToObservation(result: ToolResult): string {
    if (result.ok) return result.output || "ok";
    const output = result.output.trim();
    return `failed: ${result.error ?? "unknown error"}${output ? `\n${truncate(output)}` : ""}`;
  }

  async function runToolWithPermission(
    call: ToolCall,
    agent: AgentInfo = activeAgent,
    execute?: () => Promise<ToolResult>,
  ): Promise<ToolResult | undefined> {
    const permission = getToolPermission(call.name);
    const policy = mergeAgentPermission(agent, config.permissions)[permission];
    appendSessionEvent({
      type: "tool_settlement",
      payload: { ...createToolSettlement({ call, status: "pending" }), agentId: agent.id },
    });
    updateRunVisualizationFromToolSettlement(call, "pending");

    if (policy === "deny") {
      appendSessionEvent({
        type: "permission_decision",
        payload: { toolCallId: call.id, action: permission, decision: "deny" },
      });
      appendSessionEvent({
        type: "tool_settlement",
        payload: {
          ...createToolSettlement({
            call,
            status: "denied",
            endedAt: new Date().toISOString(),
          }),
          agentId: agent.id,
        },
      });
      updateRunVisualizationFromToolSettlement(call, "denied");
      addMessage(`Denied by config: ${call.name}`);
      return;
    }

    if (policy === "prompt") {
      const allow = await new Promise<boolean>((resolve) => {
        updatePendingPermission({
          call,
          description: `${call.name}: ${JSON.stringify(call.input)}`,
          resolve,
        });
        addMessage(`Allow ${call.name}? Press y to allow or n to deny.`);
      });

      updatePendingPermission(undefined);
      if (foregroundAbortControllerRef.current?.signal.aborted) {
        appendSessionEvent({
          type: "tool_settlement",
          payload: {
            ...createToolSettlement({
              call,
              status: "interrupted",
              endedAt: new Date().toISOString(),
            }),
            agentId: agent.id,
          },
        });
        throw createAbortError();
      }

      appendSessionEvent({
        type: "permission_decision",
        payload: { toolCallId: call.id, action: permission, decision: allow ? "allow" : "deny" },
      });

      if (!allow) {
        appendSessionEvent({
          type: "tool_settlement",
          payload: {
            ...createToolSettlement({
              call,
              status: "denied",
              endedAt: new Date().toISOString(),
            }),
            agentId: agent.id,
          },
        });
        updateRunVisualizationFromToolSettlement(call, "denied");
        addMessage(`Denied: ${call.name}`);
        return;
      }
    }

    return await executeToolCall(call, agent, execute);
  }

  function resolvePermission(allow: boolean): void {
    const current = pendingPermissionRef.current;
    if (!current) {
      return;
    }

    current.resolve(allow);
  }

  function resolveQuestion(answer: string | undefined): void {
    const current = pendingQuestionRef.current;
    if (!current) {
      return;
    }

    current.resolve(answer);
  }

  function updatePendingPermission(next: PendingPermission | undefined): void {
    pendingPermissionRef.current = next;
    setPendingPermission(next);
  }

  function updatePendingQuestion(next: PendingQuestion | undefined): void {
    pendingQuestionRef.current = next;
    setPendingQuestion(next);
  }

  function readPendingQuestionAnswer(): string | undefined {
    const customAnswer = questionAnswer.trim();
    if (customAnswer.length > 0) {
      return customAnswer;
    }

    if (questionSelectedOptionIndexes.size > 0) {
      return [...questionSelectedOptionIndexes]
        .sort((left, right) => left - right)
        .map((index) => String(index + 1))
        .join(", ");
    }

    const activeQuestion = pendingQuestion?.questions[0];
    if (activeQuestion && activeQuestion.options.length > 0) {
      return String(questionOptionIndex + 1);
    }

    return undefined;
  }

  async function executeToolCall(
    call: ToolCall,
    agent: AgentInfo = activeAgent,
    execute?: () => Promise<ToolResult>,
  ): Promise<ToolResult> {
    const signal = foregroundAbortControllerRef.current?.signal;
    beginBusy();
    setActiveStatus(`Running ${formatToolCallSummary(call)}`);
    const startedAtMs = Date.now();
    const startedAt = new Date(startedAtMs).toISOString();
    appendSessionEvent({ type: "tool_call", payload: call });
    appendSessionEvent({
      type: "tool_settlement",
      payload: {
        ...createToolSettlement({ call, status: "running", startedAt }),
        agentId: agent.id,
      },
    });
    upsertToolCallPart(call, "running", { startedAtMs });
    updateRunVisualizationFromToolSettlement(call, "running");

    try {
      const result = execute
        ? await execute()
        : call.name === "question"
          ? await runInteractiveQuestionTool(call)
          : await dependencies.runTool(call, {
              workspaceRoot: config.workspaceRoot,
              ...(signal === undefined ? {} : { signal }),
            });
      if (signal?.aborted) throw createAbortError();
      if (result.ok && call.name === "todowrite") {
        const nextTodos = readTodosFromToolInput(call.input);
        setTodos(nextTodos);
        appendSessionEvent({ type: "todo_update", payload: { todos: nextTodos } });
      }
      const durationMs = Date.now() - startedAtMs;
      appendSessionEvent({ type: "tool_result", payload: result });
      appendSessionEvent({
        type: "tool_settlement",
        payload: {
          ...createToolSettlement({
            call,
            status: result.ok ? "succeeded" : "failed",
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs,
            result,
          }),
          agentId: agent.id,
        },
      });
      updateRunVisualizationFromToolSettlement(call, result.ok ? "succeeded" : "failed");
      setActiveStatus(formatCompletedToolStatus(result, call.input, durationMs));
      upsertToolResultPart(result, call.input, { durationMs, endedAtMs: Date.now() });
      return result;
    } catch (error) {
      if (!isAbortError(error, signal)) throw error;
      const durationMs = Date.now() - startedAtMs;
      appendSessionEvent({
        type: "tool_settlement",
        payload: {
          ...createToolSettlement({
            call,
            status: "interrupted",
            startedAt,
            endedAt: new Date().toISOString(),
            durationMs,
          }),
          agentId: agent.id,
        },
      });
      updateRunVisualizationFromToolSettlement(call, "interrupted");
      upsertInterruptedToolPart(call, durationMs);
      throw error;
    } finally {
      setActiveStatus("Ready");
      endBusy();
    }
  }

  function upsertToolCallPart(
    call: ToolCall,
    status: "pending" | "running",
    metadata: { startedAtMs?: number } = {},
  ): void {
    const messageId = findAssistantMessageForTool(call) ?? getActiveAssistantMessageId();
    const target = formatToolInputTarget(call.name, call.input);
    updateTranscriptMessage(
      messageId,
      () => createAssistantMessage(messageId, activeAgent, { providerId: activeProviderId }),
      (message) =>
        upsertTranscriptPart(message, {
          id: findToolPartId(message, call) ?? `tool:${call.id}`,
          type: "tool",
          tool: call.name,
          state: {
            status,
            input: call.input,
            metadata: target ? { target } : undefined,
            time: { start: metadata.startedAtMs ?? Date.now() },
          },
        }),
    );
  }

  function upsertToolResultPart(
    result: ToolResult,
    input: unknown,
    metadata: { durationMs: number; endedAtMs: number },
  ): void {
    const messageId =
      findAssistantMessageForTool({ id: result.id, name: result.name, input }) ??
      getActiveAssistantMessageId();
    const summary = formatToolResultSummary(result, input);
    updateTranscriptMessage(
      messageId,
      () => createAssistantMessage(messageId, activeAgent, { providerId: activeProviderId }),
      (message) =>
        upsertTranscriptPart(message, {
          id:
            findToolPartId(message, { id: result.id, name: result.name, input }) ??
            `tool:${result.id}`,
          type: "tool",
          tool: result.name,
          state: {
            status: result.ok ? "completed" : "error",
            input,
            output: result.ok ? result.output.trim() : undefined,
            error: result.ok ? undefined : (result.error ?? result.output).trim(),
            title: summary.content,
            metadata: {
              durationMs: metadata.durationMs,
              ...(summary.target ? { target: summary.target } : {}),
              ...(summary.countLabel ? { countLabel: summary.countLabel } : {}),
              ...(summary.summary ? { summary: summary.summary } : {}),
              ...(summary.preview ? { preview: summary.preview } : {}),
            },
            time: { start: metadata.endedAtMs - metadata.durationMs, end: metadata.endedAtMs },
          },
        }),
    );
  }

  function upsertInterruptedToolPart(call: ToolCall, durationMs: number): void {
    const messageId = findAssistantMessageForTool(call) ?? getActiveAssistantMessageId();
    updateTranscriptMessage(
      messageId,
      () => createAssistantMessage(messageId, activeAgent, { providerId: activeProviderId }),
      (message) =>
        upsertTranscriptPart(message, {
          id: findToolPartId(message, call) ?? `tool:${call.id}`,
          type: "tool",
          tool: call.name,
          state: {
            status: "interrupted",
            input: call.input,
            error: "Interrupted by user.",
            metadata: { durationMs },
            time: { start: Date.now() - durationMs, end: Date.now() },
          },
        }),
    );
  }

  function getActiveAssistantMessageId(): string {
    const progress = activeRunProgressRef.current;
    if (progress.runId && progress.lastStepId)
      return `assistant:${progress.runId}:${progress.lastStepId}`;
    if (progress.runId) return `assistant:${progress.runId}:tool`;
    return `assistant:manual:${providerSessionIdRef.current}`;
  }

  function findAssistantMessageForTool(
    call: Pick<ToolCall, "id" | "name" | "input">,
  ): string | undefined {
    const current = messages.findLast(
      (message) =>
        message.role === "assistant" &&
        message.parts.some(
          (part) =>
            part.type === "tool" && (part.id === `tool:${call.id}` || isSameToolPart(part, call)),
        ),
    );
    return current?.id;
  }

  function findToolPartId(
    message: TranscriptMessage,
    call: Pick<ToolCall, "id" | "name" | "input">,
  ): string | undefined {
    return message.parts.find((part) => part.type === "tool" && isSameToolPart(part, call))?.id;
  }

  async function runInteractiveQuestionTool(call: ToolCall): Promise<ToolResult> {
    try {
      const questions = readQuestionPrompts(call.input);
      const answer = await new Promise<string | undefined>((resolve) => {
        setQuestionAnswer("");
        setQuestionOptionIndex(0);
        setQuestionSelectedOptionIndexes(new Set());
        updatePendingQuestion({ call, questions, resolve });
        addMessage("question: waiting for user answer");
      });

      return {
        id: call.id,
        name: call.name,
        ok: true,
        output: formatQuestionAnswerOutput(questions, answer),
      };
    } catch (error) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        output: "",
        error: formatError(error),
      };
    } finally {
      updatePendingQuestion(undefined);
      setQuestionAnswer("");
      setQuestionOptionIndex(0);
      setQuestionSelectedOptionIndexes(new Set());
    }
  }

  async function runVerification(command: string): Promise<string> {
    if (mergeAgentPermission(activeAgent, config.permissions).shell === "deny") {
      const message = `${activeAgent.id} agent cannot run verification because shell permission is denied.`;
      addMessage(message);
      return message;
    }

    if (foregroundAbortControllerRef.current)
      return "Cannot verify while another operation is running.";
    const abortController = new AbortController();
    const completion = createCompletion();
    foregroundAbortControllerRef.current = abortController;
    foregroundCompletionRef.current = completion.promise;
    beginBusy();

    try {
      const results = await runVerificationCommands({
        commands: command.length > 0 ? [command] : config.verificationCommands,
        cwd: config.workspaceRoot,
        signal: abortController.signal,
      });

      for (const result of results) {
        appendSessionEvent({
          type: "verification_result",
          payload: { ...result, agentId: activeAgent.id },
        });
        addMessage(`verify: ${result.command}: ${result.status}`);
      }

      return results.map(formatVerificationResult).join("\n\n");
    } finally {
      if (foregroundAbortControllerRef.current === abortController) {
        foregroundAbortControllerRef.current = undefined;
        foregroundCompletionRef.current = undefined;
      }
      completion.resolve();
      endBusy();
    }
  }

  async function runAgentVerification(
    action: Extract<ExecutableAgentAction, { type: "verify" }>,
    agent: AgentInfo,
  ): Promise<string> {
    const commands = action.command?.trim() ? [action.command.trim()] : config.verificationCommands;
    if (commands.length === 0) return "No verification command was provided or configured.";

    const observations: string[] = [];
    for (const [index, command] of commands.entries()) {
      const call = createToolCallForExecutableAction({
        ...action,
        command,
        ...(index === 0 ? {} : { toolCallId: undefined }),
      });
      if (!call) continue;

      const result = await runToolWithPermission(call, agent, async () => {
        const [verification] = await runVerificationCommands({
          commands: [command],
          cwd: config.workspaceRoot,
          signal: foregroundAbortControllerRef.current?.signal,
        });
        if (!verification) {
          return {
            id: call.id,
            name: call.name,
            ok: false,
            output: "",
            error: `Verification produced no result: ${command}`,
          };
        }

        appendSessionEvent({
          type: "verification_result",
          payload: { ...verification, agentId: agent.id },
        });
        return {
          id: call.id,
          name: call.name,
          ok: verification.status === "passed",
          output: formatVerificationResult(verification),
          ...(verification.status === "passed"
            ? {}
            : { error: verification.stderr || `Command exited with ${verification.exitCode}.` }),
        };
      });
      if (!result) return `${command} did not run.`;
      observations.push(toolResultToObservation(result));
    }

    return observations.join("\n\n");
  }

  async function runSummary(): Promise<void> {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const summary = summarizeWorkspace({
      workspaceRoot: config.workspaceRoot,
      events: store.listEvents(currentSession.id),
    });
    appendSessionEvent({ type: "summary", payload: summary });
    addMessage(summary.text);
  }

  async function reviseFromVerificationFailures(): Promise<void> {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const operation = startForegroundOperation();
    if (!operation) return;
    beginBusy();

    try {
      const context = buildRevisionContext({
        workspaceRoot: config.workspaceRoot,
        events: store.listEvents(currentSession.id),
      });

      if (context.verificationFailures.length === 0) {
        addMessage("No verification failures found. Run /verify first.");
        return;
      }

      const adapter = dependencies.createPrimaryModelAdapter(config);
      const response = await adapter.generateText({
        system:
          "You are MAGI revising a local code change. Use the provided verification failures and changed files. Suggest the smallest correct fix. If a patch is appropriate, provide a git-apply-compatible unified diff inside a ```diff fenced code block. Do not claim you ran commands.",
        prompt: context.text,
        signal: operation.controller.signal,
      });
      operation.controller.signal.throwIfAborted();
      const event = appendSessionEvent({
        type: "assistant_message",
        payload: {
          content: response.text,
          revision: true,
          runId: `revision-${crypto.randomUUID()}`,
          stepId: "final",
        },
      });
      saveProposedPatch(event.id, response.text);
      addMessage(`Revision: ${truncate(response.text)}`, event.id);
    } catch (error) {
      if (!isAbortError(error, operation.controller.signal))
        addMessage(`Revision error: ${formatError(error)}`);
    } finally {
      operation.finish();
      endBusy();
    }
  }

  async function applyLastProposedPatch(): Promise<void> {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const patch = getLatestProposedPatch(store.listEvents(currentSession.id));

    if (!patch) {
      addMessage("No proposed patch found. Run /revise first.");
      return;
    }

    const operation = startForegroundOperation();
    if (!operation) return;
    try {
      await runToolWithPermission(createToolCall("apply_patch", { patch }));
    } catch (error) {
      if (!isAbortError(error, operation.controller.signal)) throw error;
    } finally {
      operation.finish();
    }
  }

  function saveProposedPatch(sourceEventId: string, content: string): void {
    const patch = extractFirstDiffBlock(content);

    if (!patch) {
      return;
    }

    const event = appendSessionEvent({
      type: "proposed_patch",
      payload: { sourceEventId, patch },
    });
    addMessage(`Proposed patch saved as event #${event.sequence}. Use /apply_last_patch to apply.`);
  }

  async function previewMagiContext(): Promise<void> {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const operation = startForegroundOperation();
    if (!operation) return;
    beginBusy();
    try {
      const events = store.listEvents(currentSession.id);
      const latestUserMessage = [...events]
        .reverse()
        .find((event) => event.type === "user_message");
      const requirementPayload = latestUserMessage?.payload as { content?: unknown } | undefined;
      const requirement =
        typeof requirementPayload?.content === "string"
          ? requirementPayload.content
          : "No user requirement yet.";
      const sharedContextHistory = buildSharedContextHistory({
        requirement,
        sessionEvents: events,
      });
      const summary = summarizeWorkspace({ workspaceRoot: config.workspaceRoot, events });
      const lenses = selectReviewLenses({
        riskLevel: summary.residualRisk,
        changedFiles: summary.changedFiles,
      });
      const catalogResult = await getModelsDevCatalogResult(operation.controller.signal);
      const effectiveProviders = listEffectiveModelProviders({
        configProviders: config.modelProviders,
        workspaceRoot: config.workspaceRoot,
        ...(catalogResult.catalog === undefined ? {} : { modelsDevCatalog: catalogResult.catalog }),
      });
      const engineReadiness = selectMagiEngineCandidates({
        providers: effectiveProviders,
        selection: config.magi.selection,
      });

      addMessage(
        [
          "MAGI preview:",
          `- Models.dev: ${catalogResult.summary}`,
          `- shared context entries: ${sharedContextHistory.entries.length}`,
          `- selected lenses: ${lenses.map((lens) => lens.id).join(", ")}`,
          `- residual risk: ${summary.residualRisk}`,
          `- engine candidates: ${formatMagiEngineCandidates(engineReadiness.candidates)}`,
          `- selected engines (${engineReadiness.readyCount}/${engineReadiness.requiredCount} required): ${formatMagiEngineCandidates(engineReadiness.selectedEngines)}`,
          engineReadiness.unreadyConfiguredEngines.length === 0
            ? "- unready configured engines: none"
            : `- unready configured engines: ${formatMagiEngineCandidates(engineReadiness.unreadyConfiguredEngines)}`,
          `- MAGI selection ready: ${engineReadiness.ready ? "yes" : "no"}`,
        ].join("\n"),
      );
    } catch (error) {
      if (!isAbortError(error, operation.controller.signal))
        addMessage(`MAGI preview error: ${formatError(error)}`);
    } finally {
      operation.finish();
      endBusy();
    }
  }

  async function getModelsDevCatalogResult(signal?: AbortSignal): Promise<{
    catalog?: Awaited<ReturnType<typeof loadModelsDevCatalog>>;
    summary: string;
  }> {
    try {
      const catalog = await loadModelsDevCatalog({ workspaceRoot: config.workspaceRoot, signal });
      const providers = Object.values(catalog);
      const modelCount = providers.reduce(
        (count, provider) => count + Object.keys(provider.models).length,
        0,
      );
      return { catalog, summary: `${providers.length} providers, ${modelCount} models` };
    } catch (error) {
      if (isAbortError(error, signal)) throw error;
      return { summary: `unavailable (${formatError(error)})` };
    }
  }

  function showSessionSelector(includeAll: boolean): void {
    if (!canSwitchSessions()) {
      return;
    }

    const visibleSessions = getRecentSessionOptions(includeAll);

    if (visibleSessions.length === 0) {
      addMessage(
        includeAll
          ? "No sessions found."
          : "No meaningful sessions found. Use /sessions all to show empty and command-only sessions.",
      );
      return;
    }

    setPendingSelector({
      title: includeAll ? "Recent Sessions" : "Recent Meaningful Sessions",
      subtitle: "Select a session to resume.",
      selectedIndex: Math.max(
        0,
        visibleSessions.findIndex((candidate) => candidate.session.id === session?.id),
      ),
      items: visibleSessions.map(({ session: listedSession, events, displayTitle }) => ({
        value: listedSession.id,
        label: `${listedSession.id === session?.id ? "* " : ""}${displayTitle}`,
        description: `${listedSession.id.slice(0, 8)}  ${events.length} events  ${listedSession.updatedAt}`,
      })),
      onSelect(item) {
        resumeSession(item.value);
      },
    });
  }

  function getRecentSessionOptions(includeAll: boolean): Array<{
    session: Session;
    events: SessionEvent[];
    displayTitle: string;
  }> {
    return store
      .listSessions({ workspaceRoot: config.workspaceRoot, limit: 50 })
      .map((listedSession) => {
        const events = store.listEvents(listedSession.id);

        return {
          session: listedSession,
          events,
          displayTitle: getSessionDisplayTitle(listedSession, events),
        };
      })
      .filter((listedSession) => includeAll || isMeaningfulSession(listedSession.displayTitle))
      .slice(0, 10);
  }

  function resumeSession(rawSessionSelector: string): void {
    if (!canSwitchSessions()) {
      return;
    }

    const sessionSelector = rawSessionSelector.trim();

    if (sessionSelector.length === 0) {
      addMessage("Usage: /resume <session-id-or-list-number>");
      return;
    }

    const selectedSession = resolveSessionSelector(sessionSelector);

    if (!selectedSession) {
      addMessage(`Session not found: ${sessionSelector}`);
      return;
    }

    const selectedEvents = store.listEvents(selectedSession.id);
    resetSessionTransientState();
    sessionJournal.selectSession(selectedSession);
    setSession(selectedSession);
    providerSessionIdRef.current = selectedSession.id;
    setTodos(getLatestTodos(selectedEvents));
    setActiveAgent(getAgent(getLatestAgentId(selectedEvents)) ?? getDefaultAgent());
    setActiveProviderId(getRestoredModelProviderId(selectedEvents, config));
    setMessages([
      createSystemMessage(
        `Resumed session: ${selectedSession.id}${selectedSession.title ? ` (${selectedSession.title})` : ""}`,
      ),
      ...sessionEventsToTranscriptMessages(selectedEvents, 30),
    ]);
  }

  function createNewSession(_title: string): void {
    if (!canSwitchSessions()) {
      return;
    }

    resetSessionTransientState();
    sessionJournal.resetToDraft();
    providerSessionIdRef.current = crypto.randomUUID();
    setActiveProviderId(
      getDefaultModelSelection({ modelProviders: effectiveModelProviders })?.providerId,
    );
    setSession(undefined);
    setActiveAgent(getDefaultAgent());
    setTodos([]);
    setMessages([
      createSystemMessage(
        "Started a new draft session. It will be saved after the first successful prompt.",
      ),
    ]);
  }

  function resetSessionTransientState(): void {
    queuedPromptsRef.current = [];
    steeringInputsRef.current = [];
    interruptionRequestedRef.current = false;
    activeRunProgressRef.current = createEmptyRunProgress();
    liveAssistantStreamsRef.current.clear();
    liveToolActivitiesRef.current.clear();
    setRunVisualization("idle");
    setActiveStatus("Ready");
    setSelectedMessageId(undefined);
    setExpandedMessageIds(new Set());
    setTranscriptScrollOffset(0);
    setPendingSelector(undefined);
  }

  function renameCurrentSession(title: string): void {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      addMessage(
        "No saved session to rename. Run a normal prompt first, or /resume an existing session.",
      );
      return;
    }

    if (title.length === 0) {
      addMessage("Usage: /rename <title>");
      return;
    }

    const updatedSession = store.updateSession({ sessionId: currentSession.id, title });
    sessionJournal.selectSession(updatedSession);
    setSession(updatedSession);
    addMessage(`Renamed session: ${title}`);
  }

  function showHistory(rawLimit: string | undefined): void {
    const currentSession = sessionJournal.getSession();
    if (!currentSession) {
      addMessage(
        "No saved session history. Run a normal prompt first, or /resume an existing session.",
      );
      return;
    }

    const limit =
      rawLimit === undefined || rawLimit.length === 0 ? 20 : Number.parseInt(rawLimit, 10);

    if (!Number.isInteger(limit) || limit < 1) {
      addMessage("Usage: /history [positive-limit]");
      return;
    }

    const events = store.listEvents(currentSession.id).slice(-limit);
    addMessage(
      [
        `Recent history (${events.length} events):`,
        ...events.map(
          (event) => `${event.sequence}. ${event.type}: ${formatSessionEventSummary(event)}`,
        ),
      ].join("\n"),
    );
  }

  async function switchAgentAndMaybeRun(agentId: string, content: string): Promise<void> {
    const agent = switchAgent(agentId);

    if (!agent || content.length === 0) {
      return;
    }

    await submitAgentPrompt(content, agent, activeProviderId);
  }

  async function handleAuthCommand(args: string[]): Promise<void> {
    const [subcommand = "status", provider = "openai", mode = "browser"] = args;

    if (provider !== "openai") {
      addMessage("Only OpenAI auth is supported right now.");
      return;
    }

    if (subcommand === "status") {
      const auth = getAuth({ workspaceRoot: config.workspaceRoot, providerId: "openai" });

      if (!auth) {
        addMessage("OpenAI auth: not logged in.");
        return;
      }

      if (auth.type === "oauth") {
        addMessage(
          [
            "OpenAI auth: oauth",
            `Expires: ${new Date(auth.expires).toISOString()}`,
            `Account: ${auth.accountId ?? "unknown"}`,
          ].join("\n"),
        );
        return;
      }

      addMessage(`OpenAI auth: ${auth.type}`);
      return;
    }

    if (subcommand === "logout") {
      removeAuth({ workspaceRoot: config.workspaceRoot, providerId: "openai" });
      addMessage("OpenAI auth removed.");
      return;
    }

    if (subcommand === "refresh") {
      const auth = getAuth({ workspaceRoot: config.workspaceRoot, providerId: "openai" });

      if (auth?.type !== "oauth") {
        addMessage("OpenAI OAuth auth is missing. Run /auth login openai.");
        return;
      }

      const operation = startForegroundOperation();
      if (!operation) return;
      beginBusy();

      try {
        const refreshed = await refreshOpenAICodexAuth({
          workspaceRoot: config.workspaceRoot,
          auth,
          signal: operation.controller.signal,
        });
        addMessage(`OpenAI OAuth refreshed. Expires: ${new Date(refreshed.expires).toISOString()}`);
      } catch (error) {
        if (!isAbortError(error, operation.controller.signal))
          addMessage(`OpenAI OAuth refresh failed. Run /auth login openai. ${formatError(error)}`);
      } finally {
        operation.finish();
        endBusy();
      }

      return;
    }

    if (subcommand !== "login") {
      addMessage(
        "Usage: /auth status | /auth login openai [browser|headless] | /auth refresh openai | /auth logout openai",
      );
      return;
    }

    const operation = startForegroundOperation();
    if (!operation) return;
    beginBusy();

    try {
      if (mode === "headless") {
        const auth = await loginOpenAICodexHeadless({
          workspaceRoot: config.workspaceRoot,
          signal: operation.controller.signal,
          onUserCode({ url, code }) {
            addMessage(`Open ${url} and enter code: ${code}`);
          },
        });
        addMessage(`OpenAI OAuth login complete. Account: ${auth.accountId ?? "unknown"}`);
        return;
      }

      const auth = await loginOpenAICodexBrowser({
        workspaceRoot: config.workspaceRoot,
        signal: operation.controller.signal,
        openUrl(url) {
          addMessage(`Opening browser for OpenAI OAuth: ${url}`);
          openExternalUrl(url);
        },
      });
      addMessage(`OpenAI OAuth login complete. Account: ${auth.accountId ?? "unknown"}`);
    } catch (error) {
      if (!isAbortError(error, operation.controller.signal))
        addMessage(`OpenAI OAuth login failed: ${formatError(error)}`);
    } finally {
      operation.finish();
      endBusy();
    }
  }

  function handleModelCommand(args: string[]): void {
    const [subcommand = ""] = args;

    if (subcommand.length === 0) {
      showModelSelector();
      return;
    }

    if (subcommand === "status") {
      addMessage(formatModelStatus(activeProviderId));
      return;
    }

    if (subcommand === "reset") {
      const selection = getDefaultModelSelection({ modelProviders: effectiveModelProviders });

      if (!selection) {
        addMessage("No model providers configured.");
        return;
      }

      switchModelProvider(selection.providerId);
      return;
    }

    switchModelProvider(subcommand);
  }

  function showModelSelector(): void {
    if (busyDepthRef.current > 0 || pendingPermission) {
      addMessage("Cannot switch models while a command is running or waiting for permission.");
      return;
    }

    if (effectiveModelProviders.length === 0) {
      addMessage("No model providers configured.");
      return;
    }

    const activeId = activeProviderId ?? effectiveModelProviders[0]?.id;
    setPendingSelector({
      title: "Select Model",
      subtitle: "Use /model status for the detailed provider list.",
      selectedIndex: Math.max(
        0,
        effectiveModelProviders.findIndex((provider) => provider.id === activeId),
      ),
      items: effectiveModelProviders.map((provider) => ({
        value: provider.id,
        label: `${provider.id === activeId ? "* " : ""}${provider.id}`,
        description: `${provider.model}  ${provider.provider}  ${provider.source}`,
      })),
      onSelect(item) {
        switchModelProvider(item.value);
      },
    });
  }

  function showModeStatus(): void {
    addMessage(
      [
        `Mode: ${task.mode}`,
        `Agent: ${activeAgent.id} (${activeAgent.mode})`,
        `Model: ${formatProviderLine(activeProviderId ?? effectiveModelProviders[0]?.id, true)}`,
        `Risk: ${task.riskLevel}`,
        `Session: ${sessionJournal.getSession()?.id ?? "draft"}`,
        `Queued prompts: ${queuedPromptsRef.current.length}`,
      ].join("\n"),
    );
  }

  function switchModelProvider(providerId: string): void {
    if (busyDepthRef.current > 0 || pendingPermission) {
      addMessage("Cannot switch models while a command is running or waiting for permission.");
      return;
    }

    const provider = effectiveModelProviders.find((candidate) => candidate.id === providerId);

    if (!provider) {
      addMessage(`Model provider not configured: ${providerId}`);
      return;
    }

    const previousProviderId = activeProviderId;
    setActiveProviderId(provider.id);
    appendSessionEvent({
      type: "model_switch",
      payload: {
        providerId: provider.id,
        model: provider.model,
        ...(previousProviderId === undefined ? {} : { previousProviderId }),
      },
    });
    addMessage(`Switched model: ${provider.id} (${provider.model})`);
  }

  function formatModelStatus(providerId: string | undefined): string {
    if (effectiveModelProviders.length === 0) {
      return "No model providers configured.";
    }

    const activeId = providerId ?? effectiveModelProviders[0]?.id;
    const lines = [
      `Active model: ${formatProviderLine(activeId, true)}`,
      "Available models:",
      ...effectiveModelProviders.map((provider) =>
        formatProviderLine(provider.id, false, activeId),
      ),
    ];

    return lines.join("\n");
  }

  function formatProviderLine(
    providerId: string | undefined,
    compact: boolean,
    activeId = providerId,
  ): string {
    if (!providerId) {
      return "none";
    }

    const provider = effectiveModelProviders.find((candidate) => candidate.id === providerId);

    if (!provider) {
      return providerId;
    }

    const marker = compact ? "" : provider.id === activeId ? "* " : "- ";
    const auth =
      provider.auth?.type === "oauth"
        ? `oauth:${provider.authStatus ?? "unknown"}`
        : provider.apiKeyEnv
          ? `env:${provider.apiKeyEnv}`
          : "default";
    const source = compact ? "" : `, ${provider.source}`;

    return `${marker}${provider.id} (${provider.model}, ${provider.provider}, ${auth}${source})`;
  }

  function switchAgent(agentId: string): AgentInfo | undefined {
    if (agentId.length === 0) {
      addMessage(
        [
          `Active agent: ${activeAgent.id}`,
          "Available agents:",
          ...listAgents().map(
            (agent) =>
              `${agent.id === activeAgent.id ? "*" : "-"} ${agent.id} (${agent.mode}) - ${agent.description}`,
          ),
        ].join("\n"),
      );
      return undefined;
    }

    if (busyDepthRef.current > 0 || pendingPermission) {
      addMessage("Cannot switch agents while a command is running or waiting for permission.");
      return undefined;
    }

    const agent = getAgent(agentId);

    if (!agent || agent.hidden || agent.mode !== "primary") {
      addMessage(`Agent not available: ${agentId}`);
      return undefined;
    }

    setActiveAgent(agent);
    appendSessionEvent({
      type: "agent_switch",
      payload: { agentId: agent.id, previousAgentId: activeAgent.id },
    });
    addMessage(`Switched agent: ${agent.id}`);
    return agent;
  }

  function showAgentSelectorOrSwitch(agentId: string): AgentInfo | undefined {
    if (agentId.length > 0) {
      return switchAgent(agentId);
    }

    if (busyDepthRef.current > 0 || pendingPermission) {
      addMessage("Cannot switch agents while a command is running or waiting for permission.");
      return undefined;
    }

    const agents = listAgents().filter((agent) => !agent.hidden && agent.mode === "primary");
    setPendingSelector({
      title: "Select Agent",
      subtitle: "Choose the primary agent for the next prompt.",
      selectedIndex: Math.max(
        0,
        agents.findIndex((agent) => agent.id === activeAgent.id),
      ),
      items: agents.map((agent) => ({
        value: agent.id,
        label: `${agent.id === activeAgent.id ? "* " : ""}${agent.id}`,
        description: `${agent.mode}  ${agent.description}`,
      })),
      onSelect(item) {
        switchAgent(item.value);
      },
    });

    return undefined;
  }

  function showQueuedPrompts(): void {
    if (queuedPromptsRef.current.length === 0) {
      addMessage("No queued prompts.");
      return;
    }

    addMessage(
      [
        `Queued prompts (${queuedPromptsRef.current.length}):`,
        ...queuedPromptsRef.current.map(
          (queuedPrompt, index) =>
            `${index + 1}. [${queuedPrompt.providerId || "default"}/${queuedPrompt.agent.id}] ${truncateOneLine(queuedPrompt.content)}`,
        ),
      ].join("\n"),
    );
  }

  function maintainRecentSessions(): void {
    const recentSessions = store.listSessions({ workspaceRoot: config.workspaceRoot, limit: 50 });
    const actions: string[] = [];

    for (const listedSession of recentSessions) {
      const events = store.listEvents(listedSession.id);
      const plan = planSessionMaintenance({ session: listedSession, events });

      if (plan.titleCandidate !== undefined) {
        store.updateSession({ sessionId: listedSession.id, title: plan.titleCandidate });
        actions.push(`title: ${listedSession.id}: ${plan.titleCandidate}`);
      }

      if (plan.summaryCandidate !== undefined) {
        store.appendEvent({
          sessionId: listedSession.id,
          type: "context_summary",
          payload: { text: plan.summaryCandidate, source: "maintenance" },
        });
        actions.push(`summary: ${listedSession.id}`);
      }
    }

    addMessage(
      actions.length === 0 ? "No session maintenance actions needed." : actions.join("\n"),
    );
  }

  function showSessionCleanupCandidates(): void {
    const candidates = store
      .listSessions({ workspaceRoot: config.workspaceRoot, limit: 50 })
      .map((listedSession) => ({
        session: listedSession,
        plan: planSessionMaintenance({
          session: listedSession,
          events: store.listEvents(listedSession.id),
        }),
      }))
      .filter(({ plan }) => plan.cleanupCandidate);

    if (candidates.length === 0) {
      addMessage("No cleanup candidates found.");
      return;
    }

    addMessage(
      [
        "Cleanup candidates (not deleted automatically):",
        ...candidates.map(
          ({ session: candidateSession, plan }) =>
            `${candidateSession.id}: ${plan.cleanupReason ?? "cleanup candidate"}`,
        ),
      ].join("\n"),
    );
  }

  function addSteeringInput(content: string): void {
    if (content.length === 0) {
      addMessage("Usage: /steer <message>");
      return;
    }

    steeringInputsRef.current = [...steeringInputsRef.current, content];
    appendSessionEvent({
      type: "queued_user_input",
      payload: {
        content,
        agentId: activeAgent.id,
        mode: "steering",
        queuedAt: new Date().toISOString(),
      },
    });
    addMessage(`Steering input queued: ${truncateOneLine(content)}`);
  }

  function handleCtrlC(): void {
    if (foregroundAbortControllerRef.current) {
      if (interruptionRequestedRef.current) {
        closeStore();
        process.exit(130);
      }
      requestInterruption();
      return;
    }
    void requestExit();
  }

  function requestInterruption(reason = "user_cancelled"): void {
    const controller = foregroundAbortControllerRef.current;
    if (!controller || controller.signal.aborted) return;

    interruptionRequestedRef.current = true;
    const discardedQueuedPrompts = queuedPromptsRef.current.length;
    queuedPromptsRef.current = [];
    appendSessionEvent({
      type: "interruption",
      payload: {
        reason,
        discardedQueuedPrompts,
        createdAt: new Date().toISOString(),
      },
    });
    addMessage(
      `Interruption requested.${discardedQueuedPrompts > 0 ? ` Discarded ${discardedQueuedPrompts} queued prompt(s).` : ""}`,
    );
    pendingPermissionRef.current?.resolve(false);
    pendingQuestionRef.current?.resolve(undefined);
    controller.abort(createAbortError());
  }

  async function requestExit(): Promise<void> {
    await (props.lifecycle?.shutdown("user_exit") ?? shutdownApp("user_exit"));
    exit();
  }

  function shutdownApp(reason: AppShutdownReason): Promise<void> {
    shutdownPromiseRef.current ??= (async () => {
      requestInterruption(reason);
      pendingPermissionRef.current?.resolve(false);
      pendingQuestionRef.current?.resolve(undefined);
      for (const operation of backgroundOperationsRef.current.values()) {
        operation.controller.abort(createAbortError());
      }
      const operations = [
        ...(foregroundCompletionRef.current ? [foregroundCompletionRef.current] : []),
        ...[...backgroundOperationsRef.current.values()].map((operation) => operation.promise),
      ];
      await Promise.allSettled(operations);
      closeStore();
    })();
    return shutdownPromiseRef.current;
  }

  function closeStore(): void {
    if (storeClosedRef.current) return;
    storeClosedRef.current = true;
    store.close();
  }

  function startForegroundOperation():
    | { controller: AbortController; finish: () => void }
    | undefined {
    if (foregroundAbortControllerRef.current) {
      addMessage("Another foreground operation is already running.");
      return undefined;
    }
    const controller = new AbortController();
    const completion = createCompletion();
    foregroundAbortControllerRef.current = controller;
    foregroundCompletionRef.current = completion.promise;
    interruptionRequestedRef.current = false;
    return {
      controller,
      finish() {
        if (foregroundAbortControllerRef.current === controller) {
          foregroundAbortControllerRef.current = undefined;
          foregroundCompletionRef.current = undefined;
        }
        completion.resolve();
      },
    };
  }

  async function drainQueuedPrompts(): Promise<void> {
    if (queuedPromptsRef.current.length === 0 || busyDepthRef.current > 1 || pendingPermission) {
      return;
    }

    const [nextPrompt, ...remainingPrompts] = queuedPromptsRef.current;
    queuedPromptsRef.current = remainingPrompts;

    if (nextPrompt !== undefined) {
      const userEvent = appendSessionEvent({
        type: "user_message",
        payload: {
          content: nextPrompt.content,
          agentId: nextPrompt.agent.id,
          providerId: nextPrompt.providerId,
          source: "queued",
        },
      });
      addUserMessage(
        nextPrompt.content,
        `${userEvent.id}-user`,
        nextPrompt.agent,
        nextPrompt.providerId,
      );
      await runSingleEngineAgentTurn(nextPrompt.content, nextPrompt.agent, nextPrompt.providerId);
    }
  }

  function appendAgentTurnEvent(event: AgentTurnEvent, agent: AgentInfo): void {
    if (!mountedRef.current) return;
    appendSessionEvent({
      type: event.type,
      payload: { ...event.payload, agentId: agent.id },
    });
    updateRunVisualizationFromAgentEvent(event, agent);
    updateActiveStatusFromAgentEvent(event);
    updateLiveAssistantStreamFromAgentEvent(event);
  }

  function appendAgentTurnEventToSession(
    event: AgentTurnEvent,
    agent: AgentInfo,
    targetSessionId: string,
    taskId: string,
  ): void {
    if (!mountedRef.current) return;
    store.appendEvent({
      sessionId: targetSessionId,
      type: event.type,
      payload: { ...event.payload, agentId: agent.id, taskId, background: true },
    });
  }

  function updateActiveStatusFromAgentEvent(event: AgentTurnEvent): void {
    switch (event.type) {
      case "assistant_started":
        setActiveStatus(formatThinkingStatus(activeRunProgressRef.current));
        return;
      case "provider_error":
        setActiveStatus("Provider error");
        addProviderErrorDisplayMessage(event);
        return;
      case "assistant_status": {
        const payload = event.payload as { kind?: unknown };
        setActiveStatus(String(payload.kind ?? "assistant status"));
        return;
      }
      case "assistant_stream": {
        const status = formatAssistantStreamStatus(event.payload);
        if (status !== undefined) setActiveStatus(status);
        return;
      }
      case "agent_tool_skipped":
        setActiveStatus(`Skipped repeated ${event.payload.toolName}`);
        addSkippedToolDisplayMessage(event);
        return;
      case "agent_step_ended": {
        const payload = event.payload as { status?: unknown };
        setActiveStatus(`Step ${String(payload.status ?? "ended")}`);
        return;
      }
      case "agent_step_started":
        setActiveStatus("Preparing next step...");
        return;
    }
  }

  function updateRunVisualizationFromAgentEvent(event: AgentTurnEvent, agent: AgentInfo): void {
    const payload = event.payload as { runId?: unknown; stepId?: unknown; status?: unknown };
    if (typeof payload.runId === "string" && activeRunProgressRef.current.runId !== payload.runId) {
      activeRunProgressRef.current = {
        ...createEmptyRunProgress(),
        runId: payload.runId,
        agentId: agent.id,
      };
    }
    if (typeof payload.stepId === "string") {
      activeRunProgressRef.current.lastStepId = payload.stepId;
    }

    const progress = activeRunProgressRef.current;
    if (event.type === "agent_step_started") {
      progress.steps += 1;
      progress.lastStepStatus = "thinking";
      progress.thinkingStartedAtMs = undefined;
    } else if (event.type === "assistant_started") {
      progress.lastStepStatus = "thinking";
      progress.thinkingStartedAtMs = Date.now();
    } else if (event.type === "agent_step_ended" && typeof payload.status === "string") {
      progress.lastStepStatus = payload.status;
      progress.thinkingStartedAtMs = undefined;
      if (typeof payload.runId === "string" && payload.status !== "waiting_for_tools") {
        flushLiveToolActivity(payload.runId);
      }
    }

    setRunVisualization(formatRunVisualization(progress));
  }

  function updateLiveAssistantStreamFromAgentEvent(event: AgentTurnEvent): void {
    if (event.type !== "assistant_stream") return;

    const payload = event.payload;
    const messageId = `assistant:${payload.runId}:${payload.stepId}`;
    const stream = getLiveAssistantStream(messageId);
    const nextContent = applyAssistantTextStreamPayload(stream, payload);
    const messageFactory = () =>
      createAssistantMessage(messageId, activeAgent, {
        providerId: activeProviderId,
        model: config.modelProviders.find((provider) => provider.id === activeProviderId)?.model,
      });

    if (nextContent !== undefined) {
      updateTranscriptMessage(messageId, messageFactory, (message) =>
        upsertTranscriptPart(message, {
          id: `${messageId}:text`,
          type: "text",
          text: nextContent,
        }),
      );
      flushLiveToolActivity(payload.runId);
      return;
    }

    const reasoning = formatReasoningPart(stream, payload);
    if (reasoning !== undefined) {
      updateTranscriptMessage(messageId, messageFactory, (message) =>
        upsertTranscriptPart(message, reasoning),
      );
      return;
    }

    const toolPart = formatAssistantStreamToolPart(stream, payload);
    if (toolPart !== undefined) {
      updateTranscriptMessage(messageId, messageFactory, (message) =>
        upsertTranscriptPart(message, toolPart),
      );
    }
  }

  function addSkippedToolDisplayMessage(
    event: Extract<AgentTurnEvent, { type: "agent_tool_skipped" }>,
  ): void {
    const messageId = `assistant:${event.payload.runId}:${event.payload.stepId}`;
    updateTranscriptMessage(
      messageId,
      () => createAssistantMessage(messageId, activeAgent, { providerId: activeProviderId }),
      (message) => {
        const partId = findMatchingToolPartId(
          message,
          event.payload.toolName,
          event.payload.input,
          event.payload.toolCallId,
        );
        return upsertTranscriptPart(message, {
          id: partId,
          type: "tool",
          tool: event.payload.toolName,
          state: {
            status: "skipped",
            input: event.payload.input,
            error: event.payload.reason,
            title: "skipped repeated action",
            metadata: {
              target: formatToolInputTarget(event.payload.toolName, event.payload.input),
              summary: event.payload.reason,
            },
            time: { start: Date.now(), end: Date.now() },
          },
        });
      },
    );
  }

  function addProviderErrorDisplayMessage(
    event: Extract<AgentTurnEvent, { type: "provider_error" }>,
  ): void {
    const debug = formatProviderErrorDebug(event.payload.debug);
    const messageId = `assistant:${event.payload.runId}:${event.payload.stepId}`;
    updateTranscriptMessage(
      messageId,
      () => createAssistantMessage(messageId, activeAgent, { providerId: activeProviderId }),
      (message) =>
        upsertTranscriptPart(message, {
          id: `provider-error:${event.payload.runId}:${event.payload.stepId}`,
          type: "status",
          text: debug.summary
            ? `${event.payload.message}\n${debug.summary}`
            : event.payload.message,
          tone: "danger",
        }),
    );
  }

  function getLiveAssistantStream(messageId: string): LiveAssistantStream {
    const existing = liveAssistantStreamsRef.current.get(messageId);
    if (existing) return existing;

    const created: LiveAssistantStream = {
      text: "",
      reasoning: new Map(),
      toolInputs: new Map(),
    };
    liveAssistantStreamsRef.current.set(messageId, created);
    return created;
  }

  function updateRunVisualizationFromToolSettlement(
    call: ToolCall,
    status: "pending" | "running" | "succeeded" | "failed" | "denied" | "interrupted",
  ): void {
    const progress = activeRunProgressRef.current;
    progress.lastTool = call.name;
    progress.thinkingStartedAtMs = undefined;
    progress.toolStatuses.set(call.id, status);
    setActiveStatus(formatToolStatus(call.name, status));
    setRunVisualization(formatRunVisualization(progress));
    if (status === "pending") updateLiveToolActivity(call.name);
  }

  function updateLiveToolActivity(toolName: string): void {
    const runId = activeRunProgressRef.current.runId;
    if (!runId) return;

    const messageId = `activity:${runId}`;
    const activity = getLiveToolActivity(messageId);
    activity.toolCounts.set(toolName, (activity.toolCounts.get(toolName) ?? 0) + 1);
  }

  function getLiveToolActivity(messageId: string): LiveToolActivity {
    const existing = liveToolActivitiesRef.current.get(messageId);
    if (existing) return existing;

    const created: LiveToolActivity = { toolCounts: new Map(), displayed: false };
    liveToolActivitiesRef.current.set(messageId, created);
    return created;
  }

  function flushLiveToolActivity(runId: string): void {
    const messageId = `activity:${runId}`;
    const activity = liveToolActivitiesRef.current.get(messageId);
    if (!activity || activity.toolCounts.size === 0) return;

    activity.displayed = true;
    const assistantId = getActiveAssistantMessageId();
    updateTranscriptMessage(
      assistantId,
      () => createAssistantMessage(assistantId, activeAgent, { providerId: activeProviderId }),
      (message) =>
        upsertTranscriptPart(message, {
          id: messageId,
          type: "status",
          text: formatToolActivity(activity),
          tone: "muted",
        }),
    );
  }

  function getSessionDisplayTitle(listedSession: Session, events: SessionEvent[]): string {
    if (listedSession.title !== undefined && listedSession.title !== defaultSessionTitle) {
      return listedSession.title;
    }

    if (events.length === 0) {
      return "New empty session";
    }

    const firstPrompt = events.find((event) => {
      if (event.type !== "user_message") {
        return false;
      }

      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string" && isMeaningfulTitlePrompt(payload.content);
    });
    const payload = firstPrompt?.payload as { content?: unknown } | undefined;

    if (typeof payload?.content === "string") {
      return truncateTitle(payload.content);
    }

    return "Command-only session";
  }

  function canSwitchSessions(): boolean {
    if (busyDepthRef.current > 0 || pendingPermission) {
      addMessage("Cannot switch sessions while a command is running or waiting for permission.");
      return false;
    }

    return true;
  }

  function resolveSessionSelector(sessionSelector: string): Session | undefined {
    const numericSelector = Number.parseInt(sessionSelector, 10);

    if (String(numericSelector) === sessionSelector) {
      return store
        .listSessions({ workspaceRoot: config.workspaceRoot, limit: 50 })
        .filter((listedSession) =>
          isMeaningfulSession(
            getSessionDisplayTitle(listedSession, store.listEvents(listedSession.id)),
          ),
        )
        .slice(0, 10)[numericSelector - 1];
    }

    const exactSession = store.getSession(sessionSelector);

    if (exactSession?.workspaceRoot !== config.workspaceRoot) {
      return undefined;
    }

    return exactSession;
  }

  function appendSessionEvent(input: AppendSessionEventInput): SessionEvent {
    return sessionJournal.append(input);
  }

  function getCurrentSessionEvents(): SessionEvent[] {
    return sessionJournal.getEvents();
  }

  function persistDraftSessionIfNeeded(userMessage: string, assistantMessage: string): void {
    const result = sessionJournal.persistDraft({
      userMessage,
      assistantMessage,
      createTitle: createSessionTitle,
    });

    if (!result.persisted) return;

    providerSessionIdRef.current = result.session.id;
    setSession(result.session);
    addMessage(`Saved session: ${result.session.id} (${result.title})`);
  }

  function requirePersistedSession(message: string): boolean {
    if (sessionJournal.getSession()) {
      return true;
    }

    addMessage(message);
    return false;
  }

  function addMessage(content: string, id: string = crypto.randomUUID()): void {
    addTranscriptMessage(createSystemMessage(content, id));
  }

  function addMessageForSession(sessionId: string, content: string): void {
    if (sessionJournal.getSession()?.id === sessionId) addMessage(content);
  }

  function addUserMessage(
    content: string,
    id: string = crypto.randomUUID(),
    agent?: AgentInfo,
    providerId?: string,
  ): void {
    addTranscriptMessage({
      id,
      role: "user",
      agentId: agent?.id,
      providerId,
      createdAt: Date.now(),
      parts: [{ id: `${id}:text`, type: "text", text: content }],
    });
  }

  function addTranscriptMessage(message: TranscriptMessage): void {
    setMessages((currentMessages) => [...currentMessages, message]);
    setSelectedMessageId(message.id);
    setTranscriptScrollOffset((offset) =>
      offset === 0
        ? 0
        : offset + getTranscriptMessageLineCount({ message, expandedIds: expandedMessageIds }),
    );
  }

  function updateTranscriptMessage(
    messageId: string,
    create: () => TranscriptMessage,
    update: (message: TranscriptMessage) => TranscriptMessage,
  ): void {
    setMessages((currentMessages) => {
      const index = currentMessages.findIndex((candidate) => candidate.id === messageId);
      if (index === -1) return [...currentMessages, update(create())];

      return currentMessages.map((candidate, candidateIndex) =>
        candidateIndex === index ? update(candidate) : candidate,
      );
    });
    setSelectedMessageId(messageId);
  }

  function completeLatestAssistantMessage(
    fallbackId: string,
    finalText: string,
    agent: AgentInfo,
    metadata: { providerId?: string; model?: string },
  ): void {
    const messageId = activeRunProgressRef.current.runId
      ? `assistant:${activeRunProgressRef.current.runId}:${activeRunProgressRef.current.lastStepId ?? "final"}`
      : fallbackId;
    updateTranscriptMessage(
      messageId,
      () => createAssistantMessage(messageId, agent, metadata),
      (message) => {
        const parts =
          finalText.trim().length > 0
            ? [
                ...message.parts.filter((part) => part.type !== "text" || part.synthetic),
                { id: `${messageId}:text`, type: "text" as const, text: finalText },
              ]
            : message.parts;
        return {
          ...message,
          ...metadata,
          agentId: agent.id,
          completedAt: Date.now(),
          parts,
        };
      },
    );
  }

  function beginBusy(): void {
    busyDepthRef.current += 1;
    setBusyDepth(busyDepthRef.current);
  }

  function endBusy(): void {
    busyDepthRef.current = Math.max(0, busyDepthRef.current - 1);
    setBusyDepth(busyDepthRef.current);
  }

  return (
    <AppView
      activeAgentId={activeAgent.id}
      activeProviderId={activeProviderId}
      canReadInput={canReadInput}
      effectiveModelProviderId={effectiveModelProviders[0]?.id}
      expandedMessageIds={expandedMessageIds}
      activeStatus={activeStatus}
      isBusy={isBusy}
      layoutMode={layoutMode}
      messages={messages}
      mode={task.mode}
      pendingPermission={pendingPermission}
      pendingQuestion={pendingQuestion}
      pendingSelector={pendingSelector}
      planFilePath={activeAgent.id === "plan" ? getPlanFilePath() : undefined}
      prompt={prompt}
      promptCursor={promptCursor}
      questionAnswer={questionAnswer}
      questionOptionIndex={questionOptionIndex}
      questionSelectedOptionIndexes={questionSelectedOptionIndexes}
      queuedPromptCount={queuedPromptsRef.current.length}
      riskLevel={task.riskLevel}
      runVisualization={runVisualization}
      selectedMessageId={selectedMessageId}
      sessionId={session?.id}
      slashCommandSelectionIndex={slashSelectionIndex}
      slashCommandSuggestions={slashCommandSuggestions}
      todoOpenCount={todos.filter((todo) => todo.status !== "completed").length}
      transcriptScrollOffset={transcriptScrollOffset}
      transcriptLineLimit={transcriptLineLimit}
      onTranscriptLineLimitChange={updateMeasuredTranscriptLineLimit}
      terminalSize={terminalSize}
      workspaceRoot={config.workspaceRoot}
    />
  );
}

function createEmptyRunProgress(): ActiveRunProgress {
  return {
    runId: undefined,
    agentId: undefined,
    lastStepId: undefined,
    steps: 0,
    lastStepStatus: undefined,
    lastTool: undefined,
    thinkingStartedAtMs: undefined,
    toolStatuses: new Map(),
  };
}

function createAssistantMessage(
  id: string,
  agent: AgentInfo,
  metadata: { providerId?: string; model?: string } = {},
): TranscriptMessage {
  return {
    id,
    role: "assistant",
    agentId: agent.id,
    providerId: metadata.providerId,
    model: metadata.model,
    createdAt: Date.now(),
    parts: [],
  };
}

type AssistantStreamPayload = Extract<AgentTurnEvent, { type: "assistant_stream" }>["payload"];

function applyAssistantTextStreamPayload(
  stream: LiveAssistantStream,
  payload: AssistantStreamPayload,
): string | undefined {
  switch (payload.kind) {
    case "text_delta":
      stream.text += payload.text;
      return stream.text;
    case "reasoning_start":
      stream.reasoning.set(payload.id, "");
      return undefined;
    case "reasoning_delta":
      stream.reasoning.set(payload.id, `${stream.reasoning.get(payload.id) ?? ""}${payload.text}`);
      return undefined;
    case "reasoning_end":
      return undefined;
    case "tool_input_start":
      stream.toolInputs.set(payload.id, { toolName: payload.toolName, input: "" });
      return undefined;
    case "tool_input_delta": {
      const current = stream.toolInputs.get(payload.id) ?? { toolName: "tool", input: "" };
      stream.toolInputs.set(payload.id, { ...current, input: `${current.input}${payload.delta}` });
      return undefined;
    }
    case "tool_input_end":
      return undefined;
    case "tool_call":
      return undefined;
    case "finish_step":
      return undefined;
  }
}

function formatToolActivity(activity: LiveToolActivity): string {
  const parts = [
    formatToolCount(activity, ["grep", "glob"], "Explored", "search", "searches"),
    formatToolCount(activity, ["read"], "Read", "file", "files"),
    formatToolCount(activity, ["task"], "Delegated", "task", "tasks"),
    formatOtherToolCounts(activity),
  ].filter((part): part is string => part !== undefined);

  return parts.join("\n");
}

function formatReasoningPart(
  stream: LiveAssistantStream,
  payload: AssistantStreamPayload,
): TranscriptPart | undefined {
  if (payload.kind !== "reasoning_delta" && payload.kind !== "reasoning_end") return undefined;

  const id = payload.id;
  const text = stream.reasoning.get(id)?.trim();
  if (!text) return undefined;

  return {
    id: `reasoning:${id}`,
    type: "reasoning",
    text,
    time: { start: Date.now(), ...(payload.kind === "reasoning_end" ? { end: Date.now() } : {}) },
  };
}

function formatAssistantStreamToolPart(
  stream: LiveAssistantStream,
  payload: AssistantStreamPayload,
): TranscriptPart | undefined {
  if (
    payload.kind !== "tool_input_start" &&
    payload.kind !== "tool_input_end" &&
    payload.kind !== "tool_call"
  ) {
    return undefined;
  }

  const inputInfo = stream.toolInputs.get(payload.id);
  const toolName =
    payload.kind === "tool_call" ? payload.toolName : (inputInfo?.toolName ?? "tool");
  const input = payload.kind === "tool_call" ? payload.input : parseJsonInput(inputInfo?.input);
  const target = formatToolInputTarget(toolName, input);

  return {
    id: `tool:${payload.id}`,
    type: "tool",
    tool: toolName,
    state: {
      status: payload.kind === "tool_call" ? "running" : "pending",
      input,
      metadata: {
        ...(target ? { target } : {}),
        ...(inputInfo?.input ? { preview: truncateOneLine(inputInfo.input) } : {}),
      },
      time: { start: Date.now() },
    },
  };
}

function formatToolCount(
  activity: LiveToolActivity,
  toolNames: string[],
  label: string,
  singular: string,
  plural: string,
): string | undefined {
  const count = toolNames.reduce(
    (sum, toolName) => sum + (activity.toolCounts.get(toolName) ?? 0),
    0,
  );
  if (count === 0) return undefined;

  return `${label} ${count} ${count === 1 ? singular : plural}`;
}

function formatOtherToolCounts(activity: LiveToolActivity): string | undefined {
  const hidden = new Set(["grep", "glob", "read", "task"]);
  const count = [...activity.toolCounts]
    .filter(([toolName]) => !hidden.has(toolName))
    .reduce((sum, [, toolCount]) => sum + toolCount, 0);
  if (count === 0) return undefined;

  return `Used ${count} ${count === 1 ? "tool" : "tools"}`;
}

function formatAssistantStreamStatus(payload: AssistantStreamPayload): string | undefined {
  switch (payload.kind) {
    case "text_delta":
    case "reasoning_delta":
    case "tool_input_delta":
      return undefined;
    case "reasoning_start":
      return "Thinking - reasoning started";
    case "reasoning_end":
      return "Thinking finished";
    case "tool_input_start":
      return `Preparing ${payload.toolName}`;
    case "tool_input_end":
      return "Tool input ready";
    case "tool_call":
      return `Calling ${payload.toolName}`;
    case "finish_step":
      return `Model step finished${payload.finishReason ? `: ${payload.finishReason}` : ""}`;
  }
}

function formatRunVisualization(progress: ActiveRunProgress): string {
  if (!progress.runId) return "idle";

  const statuses = [...progress.toolStatuses.values()];
  const running = statuses.filter((status) => status === "pending" || status === "running").length;
  const succeeded = statuses.filter((status) => status === "succeeded").length;
  const failed = statuses.filter((status) => status === "failed" || status === "denied").length;
  const parts = [
    `${progress.agentId ?? "agent"}#${progress.runId.slice(0, 8)}`,
    `step ${progress.steps}`,
    `tools ${succeeded} ok/${running} active/${failed} failed`,
  ];

  if (progress.thinkingStartedAtMs !== undefined) {
    parts.push(`thinking ${formatElapsedSeconds(progress.thinkingStartedAtMs)}`);
  }
  if (progress.lastTool) parts.push(`last ${progress.lastTool}`);
  if (progress.lastStepStatus) parts.push(progress.lastStepStatus);

  return parts.join("  ");
}

function formatThinkingStatus(progress: ActiveRunProgress): string {
  if (progress.thinkingStartedAtMs === undefined) {
    return "Thinking...";
  }

  const context = progress.lastTool ? ` after ${progress.lastTool}` : "";

  return `Thinking ${formatElapsedSeconds(progress.thinkingStartedAtMs)} - waiting for model${context}`;
}

function formatToolStatus(
  toolName: string,
  status: "pending" | "running" | "succeeded" | "failed" | "denied" | "interrupted",
): string {
  if (status === "pending" || status === "running") {
    return `Tool ${toolName} ${status}`;
  }

  return `Tool ${toolName} ${status}`;
}

function formatCompletedToolStatus(result: ToolResult, input: unknown, durationMs: number): string {
  if (!result.ok) return `Tool ${result.name} failed`;

  const output = result.output.trim();
  if (result.name === "glob" || result.name === "grep") {
    const count = output.length === 0 ? 0 : output.split("\n").length;
    return `${result.name} completed: ${count} matches in ${formatDurationMs(durationMs)}`;
  }
  if (result.name === "read") {
    const path = readInputString(input, "path") ?? "file";
    return `read completed: ${path} in ${formatDurationMs(durationMs)}`;
  }
  if (result.name === "todowrite") {
    return `todos updated in ${formatDurationMs(durationMs)}`;
  }

  return `${result.name} completed in ${formatDurationMs(durationMs)}`;
}

function formatProviderErrorDebug(debug: unknown): { summary?: string; detail?: string } {
  if (!debug || typeof debug !== "object") return {};

  const value = debug as {
    agentId?: unknown;
    iteration?: unknown;
    maxIterations?: unknown;
    finishReason?: unknown;
    streamStats?: {
      textDeltaCount?: unknown;
      textCharCount?: unknown;
      reasoningDeltaCount?: unknown;
      reasoningCharCount?: unknown;
      toolCallCount?: unknown;
      toolNames?: unknown;
      streamPartTypes?: unknown;
    };
    toolCalls?: unknown;
  };
  const stats = value.streamStats;
  const toolNames = Array.isArray(stats?.toolNames)
    ? stats.toolNames.filter((name): name is string => typeof name === "string")
    : [];
  const summary = [
    typeof value.agentId === "string" ? `agent ${value.agentId}` : undefined,
    typeof value.iteration === "number" && typeof value.maxIterations === "number"
      ? `step ${value.iteration}/${value.maxIterations}`
      : undefined,
    `text ${String(stats?.textDeltaCount ?? 0)} deltas/${String(stats?.textCharCount ?? 0)} chars`,
    `reasoning ${String(stats?.reasoningDeltaCount ?? 0)} deltas/${String(stats?.reasoningCharCount ?? 0)} chars`,
    `tools ${String(stats?.toolCallCount ?? 0)}${toolNames.length > 0 ? ` [${toolNames.join(", ")}]` : ""}`,
    typeof value.finishReason === "string" ? `finish ${value.finishReason}` : undefined,
  ]
    .filter((part): part is string => part !== undefined)
    .join(" · ");

  return { summary, detail: JSON.stringify(debug, null, 2) };
}

function formatDurationMs(durationMs: number): string {
  return durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;
}

function formatElapsedSeconds(startedAtMs: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000));

  return `${elapsedSeconds}s`;
}

function createSessionTitle(input: { userMessage: string; assistantMessage: string }): string {
  const assistantTitle = titleFromAssistantMessage(input.assistantMessage);

  if (assistantTitle) {
    return assistantTitle;
  }

  if (isMeaningfulTitlePrompt(input.userMessage)) {
    return truncateTitle(input.userMessage);
  }

  return "Untitled session";
}

function titleFromAssistantMessage(message: string): string | undefined {
  const candidate = message
    .split("\n")
    .map((line) => line.trim().replace(/^[-#*\d.\s]+/, ""))
    .find((line) => isMeaningfulTitlePrompt(line));

  return candidate === undefined ? undefined : truncateTitle(candidate);
}

function formatVerificationResult(
  result: Awaited<ReturnType<typeof runVerificationCommands>>[number],
): string {
  return [
    `${result.command}: ${result.status} (exit ${result.exitCode}, ${result.durationMs}ms)`,
    result.stdout ? `stdout:\n${truncate(result.stdout)}` : "stdout: (empty)",
    result.stderr ? `stderr:\n${truncate(result.stderr)}` : "stderr: (empty)",
  ].join("\n");
}

function truncate(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}\n... truncated` : value;
}

function formatMagiEngineCandidates(
  candidates: Array<{
    family: string;
    providerId: string;
    model: string;
    ready: boolean;
    missingEnv?: string;
  }>,
): string {
  if (candidates.length === 0) return "none";

  return candidates
    .map((candidate) =>
      candidate.ready
        ? `${candidate.family}=${candidate.providerId}/${candidate.model}`
        : `${candidate.family}=${candidate.providerId}/${candidate.model} missing ${candidate.missingEnv}`,
    )
    .join(", ");
}

function formatToolCallSummary(call: ToolCall): string {
  switch (call.name) {
    case "bash":
      return `bash ${readInputString(call.input, "command") ?? "command"}`;
    case "read":
      return `read ${readInputString(call.input, "path") ?? "file"}`;
    case "grep":
      return `grep ${readInputString(call.input, "pattern") ?? "pattern"}`;
    case "glob":
      return `glob ${readInputString(call.input, "pattern") ?? "pattern"}`;
    default:
      return call.name;
  }
}

function formatToolResultMessage(result: ToolResult, input: unknown): string {
  if (!result.ok) {
    return `${result.name}: failed${result.error ? `: ${result.error}` : ""}`;
  }

  const output = result.output.trim();

  switch (result.name) {
    case "read": {
      const path = readInputString(input, "path") ?? "file";
      const lineCount = output.length === 0 ? 0 : output.split("\n").length;
      const preview = output.length === 0 ? "empty file" : truncate(output);

      return `read: ${path} (${lineCount} lines, ${result.output.length} chars)\n${preview}`;
    }
    case "glob": {
      const pattern = readInputString(input, "pattern") ?? "pattern";
      const matches = output.length === 0 ? [] : output.split("\n");

      return matches.length === 0
        ? `glob: no matches for ${pattern}`
        : `glob: ${matches.length} matches for ${pattern}\n${truncate(matches.join("\n"))}`;
    }
    case "grep": {
      const pattern = readInputString(input, "pattern") ?? "pattern";
      const include = readInputString(input, "include");
      const matches = output.length === 0 ? [] : output.split("\n");
      const target = include ? `${pattern} in ${include}` : pattern;

      return matches.length === 0
        ? `grep: no matches for ${target}`
        : `grep: ${matches.length} matches for ${target}\n${truncate(matches.join("\n"))}`;
    }
    case "webfetch": {
      const url = readInputString(input, "url") ?? "url";
      return `webfetch: ${url}\n${truncate(output)}`;
    }
    case "websearch": {
      const query = readInputString(input, "query") ?? "query";
      return `websearch: ${query}\n${truncate(output)}`;
    }
    case "todowrite":
      return `todowrite: ${formatOutputSummary(result.output)}`;
    case "question":
      return `question:\n${truncate(result.output)}`;
    case "skill":
      return `skill:\n${truncate(result.output)}`;
    case "lsp_symbols":
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover":
    case "lsp_call_hierarchy": {
      const filePath = readInputString(input, "filePath") ?? "file";
      return `${result.name}: ${filePath}\n${truncate(output)}`;
    }
    default:
      return `${result.name}: ${formatOutputSummary(result.output)}`;
  }
}

function readQuestionPrompts(input: unknown): QuestionPrompt[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("question input must be an object");
  }

  const questions = (input as Record<string, unknown>).questions;

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error("question input requires non-empty questions array");
  }

  return questions.map(readQuestionPrompt);
}

function readTodosFromToolInput(input: unknown): TodoItem[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [];
  }

  return readTodos((input as Record<string, unknown>).todos);
}

function readTodosFromPayload(input: unknown): TodoItem[] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return [];
  }

  return readTodos((input as Record<string, unknown>).todos);
}

function getLatestTodos(events: SessionEvent[]): TodoItem[] {
  const event = [...events].reverse().find((candidate) => candidate.type === "todo_update");

  return event ? readTodosFromPayload(event.payload) : [];
}

function readTodos(value: unknown): TodoItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      return [];
    }

    const todo = item as Record<string, unknown>;
    return typeof todo.content === "string" &&
      typeof todo.status === "string" &&
      typeof todo.priority === "string"
      ? [{ content: todo.content, status: todo.status, priority: todo.priority }]
      : [];
  });
}

function readQuestionPrompt(value: unknown): QuestionPrompt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("question item must be an object");
  }

  const input = value as Record<string, unknown>;
  const question = readRequiredString(input, "question");
  const header = typeof input.header === "string" ? input.header : "Question";
  const options = Array.isArray(input.options) ? input.options.map(readQuestionOption) : [];

  return { question, header, options, multiple: input.multiple === true };
}

function readQuestionOption(value: unknown): QuestionOption {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("question option must be an object");
  }

  const input = value as Record<string, unknown>;
  return {
    label: readRequiredString(input, "label"),
    description: typeof input.description === "string" ? input.description : "",
  };
}

function formatQuestionAnswerOutput(
  questions: QuestionPrompt[],
  answer: string | undefined,
): string {
  const formatted = questions
    .map((question) => `"${question.question}"="${formatQuestionAnswer(question, answer)}"`)
    .join(", ");

  return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

function formatQuestionAnswer(question: QuestionPrompt, answer: string | undefined): string {
  if (!answer) {
    return "Unanswered";
  }

  const selected = answer
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .flatMap((part) => resolveQuestionAnswerPart(question, part));

  return selected.length === 0 ? answer : selected.join(", ");
}

function resolveQuestionAnswerPart(question: QuestionPrompt, answer: string): string[] {
  const index = Number.parseInt(answer, 10);

  if (Number.isInteger(index) && index >= 1 && index <= question.options.length) {
    return [question.options[index - 1]?.label ?? answer];
  }

  const option = question.options.find(
    (candidate) => candidate.label.toLowerCase() === answer.toLowerCase(),
  );

  return option ? [option.label] : [];
}

function readRequiredString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }

  return value;
}

function truncateTitle(value: string): string {
  const title = value.trim().replaceAll("\n", " ");

  return title.length > 60 ? `${title.slice(0, 60)}...` : title;
}

function isMeaningfulTitlePrompt(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized.length < 6 || normalized.startsWith("/")) {
    return false;
  }

  return !new Set([
    "hello",
    "hello!",
    "hi",
    "hi!",
    "안녕",
    "안녕!",
    "안녕하세요",
    "안녕하세요!",
    "test",
    "test!",
    "테스트",
    "테스트!",
  ]).has(normalized);
}

function isMeaningfulSession(displayTitle: string): boolean {
  return !["New empty session", "Command-only session", "Untitled session"].includes(displayTitle);
}

function openExternalUrl(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function createAbortError(): DOMException {
  return new DOMException("Operation aborted.", "AbortError");
}

function isAbortError(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(
    signal?.aborted ||
      (error instanceof Error && error.name === "AbortError") ||
      (error instanceof DOMException && error.name === "AbortError"),
  );
}

function createCompletion(): { promise: Promise<void>; resolve: () => void } {
  let resolveCompletion: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  return { promise, resolve: resolveCompletion };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
