// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Legacy interactive controller kept behavior-preserving during app.tsx split.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Legacy interactive controller kept behavior-preserving during app.tsx split.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: Legacy interactive controller kept behavior-preserving during app.tsx split.
import { loadConfig } from "@magi/config";
import { runVerificationCommands } from "@magi/harness";
import { spawn } from "node:child_process";
import {
  buildAgentSessionContext,
  buildAgentSystemContext,
  buildRevisionContext,
  buildSharedContextHistory,
  createPrimaryModelAdapter,
  createSessionStore,
  createTask,
  createToolCall,
  createToolSettlement,
  extractFirstDiffBlock,
  getAuth,
  getAgent,
  getDefaultModelSelection,
  getDefaultAgent,
  getEffectiveModelProviderSummaries,
  getLatestProposedPatch,
  getLatestModelSelection,
  listEffectiveModelProviders,
  loadModelsDevCatalog,
  getToolPermission,
  listAgents,
  loginOpenAICodexBrowser,
  loginOpenAICodexHeadless,
  MAGI_BUILD_SWITCH_REMINDER,
  mergeAgentPermission,
  planSessionMaintenance,
  refreshOpenAICodexAuth,
  removeAuth,
  runAgentTurn,
  runTool,
  selectMagiEngineCandidates,
  selectReviewLenses,
  summarizeWorkspace,
  type ExecutableAgentAction,
  type AgentTurnEvent,
  type AgentInfo,
  type EffectiveModelProvider,
  type Session,
  type SessionEvent,
  type SessionEventType,
  type SessionStore,
  type ToolCall,
  type ToolResult,
} from "@magi/core";
import { useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { AppView } from "./app-view.js";
import {
  appendDraftSessionEvent,
  draftEventsToSessionEvents,
  persistDraftSession,
  type DraftSessionEvent,
} from "./draft-session.js";

export type TranscriptToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "denied"
  | "skipped";

export type TranscriptPart =
  | {
      id: string;
      type: "text";
      text: string;
      synthetic?: boolean;
    }
  | {
      id: string;
      type: "reasoning";
      text: string;
      time: { start: number; end?: number };
    }
  | {
      id: string;
      type: "tool";
      tool: string;
      state: {
        status: TranscriptToolStatus;
        input?: unknown;
        output?: string;
        error?: string;
        title?: string;
        metadata?: {
          durationMs?: number;
          target?: string;
          countLabel?: string;
          summary?: string;
          preview?: string;
        };
        time: { start: number; end?: number };
      };
    }
  | {
      id: string;
      type: "status";
      text: string;
      tone?: "normal" | "muted" | "success" | "warning" | "danger";
    };

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  agentId?: string;
  providerId?: string;
  model?: string;
  createdAt?: number;
  completedAt?: number;
  parts: TranscriptPart[];
};

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

export type SlashCommandInfo = {
  name: string;
  usage: string;
  description: string;
  category?: string;
  aliases?: string[];
  hidden?: boolean;
};

const slashCommands: SlashCommandInfo[] = [
  {
    name: "model",
    usage: "/model [provider-id|status|reset]",
    description: "List or switch AI models",
    category: "Model/Auth",
  },
  {
    name: "mode",
    usage: "/mode",
    description: "Show current MAGI mode, agent, model, and session",
    category: "Workflow",
  },
  {
    name: "auth",
    usage: "/auth status|login|refresh|logout openai",
    description: "Manage OpenAI OAuth auth",
    category: "Model/Auth",
  },
  {
    name: "agent",
    usage: "/agent [agent-id]",
    description: "List or switch agents",
    category: "Agent",
  },
  {
    name: "plan",
    usage: "/plan [prompt]",
    description: "Switch to plan agent, optionally run prompt",
    category: "Agent",
  },
  {
    name: "build",
    usage: "/build [prompt]",
    description: "Switch to build agent, optionally run prompt",
    category: "Agent",
  },
  { name: "queue", usage: "/queue", description: "Show queued prompts", category: "Workflow" },
  {
    name: "clear_queue",
    usage: "/clear_queue",
    description: "Clear queued prompts",
    category: "Workflow",
  },
  {
    name: "steer",
    usage: "/steer <message>",
    description: "Add steering input for the next run",
    category: "Workflow",
  },
  {
    name: "interrupt",
    usage: "/interrupt",
    description: "Stop the current run at the next safe point",
    category: "Workflow",
  },
  {
    name: "verify",
    usage: "/verify [command]",
    description: "Run verification command",
    category: "Workflow",
  },
  {
    name: "revise",
    usage: "/revise",
    description: "Revise from recent verification failures",
    category: "Workflow",
  },
  {
    name: "summary",
    usage: "/summary",
    description: "Summarize the workspace",
    category: "Session",
  },
  {
    name: "sessions",
    usage: "/sessions [all]",
    description: "List recent sessions",
    category: "Session",
  },
  {
    name: "resume",
    usage: "/resume <session-id|number>",
    description: "Resume a saved session",
    category: "Session",
  },
  { name: "new", usage: "/new", description: "Start a new draft session", category: "Session" },
  {
    name: "rename",
    usage: "/rename <title>",
    description: "Rename the current session",
    category: "Session",
  },
  {
    name: "history",
    usage: "/history [limit]",
    description: "Show session event history",
    category: "Session",
  },
  { name: "read", usage: "/read <path>", description: "Read a workspace file", hidden: true },
  {
    name: "glob",
    usage: "/glob <pattern>",
    description: "List files matching a glob",
    hidden: true,
  },
  {
    name: "grep",
    usage: "/grep <pattern> [include]",
    description: "Search workspace files",
    hidden: true,
  },
  {
    name: "webfetch",
    usage: "/webfetch <url> [format]",
    description: "Fetch web content",
    hidden: true,
  },
  {
    name: "websearch",
    usage: "/websearch [provider] <query>",
    description: "Search the web with Exa, Parallel, or Brave",
    hidden: true,
  },
  {
    name: "todowrite",
    usage: "/todowrite <json>",
    description: "Update session todo list",
    hidden: true,
  },
  {
    name: "question",
    usage: "/question <json>",
    description: "Ask structured questions",
    hidden: true,
  },
  { name: "skill", usage: "/skill <name>", description: "Load a named skill", hidden: true },
  {
    name: "lsp_symbols",
    usage: "/lsp_symbols <file>",
    description: "List document symbols",
    hidden: true,
  },
  {
    name: "lsp_definition",
    usage: "/lsp_definition <file> <line> <character>",
    description: "Find symbol definitions",
    hidden: true,
  },
  {
    name: "lsp_references",
    usage: "/lsp_references <file> <line> <character>",
    description: "Find symbol references",
    hidden: true,
  },
  {
    name: "lsp_hover",
    usage: "/lsp_hover <file> <line> <character>",
    description: "Show hover/type info",
    hidden: true,
  },
  {
    name: "lsp_call_hierarchy",
    usage: "/lsp_call_hierarchy <file> <line> <character> [incoming|outgoing|both]",
    description: "Show symbol call hierarchy",
    hidden: true,
  },
  {
    name: "bash",
    usage: "/bash <command>",
    description: "Run a shell command with permission",
    hidden: true,
  },
  {
    name: "apply_patch",
    usage: "/apply_patch <patch-file>",
    description: "Apply a patch file",
    hidden: true,
  },
  {
    name: "apply_last_patch",
    usage: "/apply_last_patch",
    description: "Apply latest proposed patch",
    hidden: true,
  },
  {
    name: "magi_preview",
    usage: "/magi_preview",
    description: "Preview MAGI consensus context",
    hidden: true,
  },
  {
    name: "maintain_sessions",
    usage: "/maintain_sessions",
    description: "Generate missing titles/summaries",
    hidden: true,
  },
  {
    name: "session_cleanup_candidates",
    usage: "/session_cleanup_candidates",
    description: "Show sessions that look safe to clean up",
    hidden: true,
  },
  { name: "help", usage: "/help", description: "Show command list", category: "Workflow" },
];
const visibleSlashCommands = slashCommands.filter((command) => command.hidden !== true);

function getSlashCommandSuggestions(input: string): SlashCommandInfo[] {
  if (!input.startsWith("/")) {
    return [];
  }

  const rawQuery = input.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (rawQuery.length === 0) {
    return visibleSlashCommands.slice(0, 8);
  }

  return visibleSlashCommands
    .filter((command) => {
      const names = [command.name, ...(command.aliases ?? [])];
      return names.some((name) => name.toLowerCase().startsWith(rawQuery));
    })
    .slice(0, 8);
}

function formatSlashCommandHelp(commands: SlashCommandInfo[]): string {
  const categories = ["Session", "Model/Auth", "Agent", "Workflow", "MAGI", "Tools"];
  const lines = ["Commands:"];

  for (const category of categories) {
    const categoryCommands = commands.filter(
      (command) => (command.category ?? "Tools") === category,
    );
    if (categoryCommands.length === 0) continue;

    lines.push("", `${category}:`);
    lines.push(...categoryCommands.map((command) => `${command.usage} - ${command.description}`));
  }

  return lines.join("\n");
}

const defaultSessionTitle = "MAGI TUI session";
const transcriptLineLimit = 28;

type InitialSessionState = {
  session?: Session;
  resumed: boolean;
};

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

export function AppController() {
  const { exit } = useApp();
  const config = loadConfig();
  const task = createTask("Bootstrap MAGI TUI");
  const canReadInput = Boolean(process.stdin.isTTY && process.stdin.setRawMode);
  const [store] = useState(() => createSessionStore({ workspaceRoot: config.workspaceRoot }));
  const [initialSession] = useState<InitialSessionState>(() => createInitialSession(store, config));
  const providerSessionIdRef = useRef(initialSession.session?.id ?? crypto.randomUUID());
  const draftEventsRef = useRef<DraftSessionEvent[]>([]);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const steeringInputsRef = useRef<string[]>([]);
  const interruptionRequestedRef = useRef(false);
  const activeRunProgressRef = useRef<ActiveRunProgress>(createEmptyRunProgress());
  const liveAssistantStreamsRef = useRef<Map<string, LiveAssistantStream>>(new Map());
  const liveToolActivitiesRef = useRef<Map<string, LiveToolActivity>>(new Map());
  const [session, setSession] = useState<Session | undefined>(initialSession.session);
  const [activeAgent, setActiveAgent] = useState<AgentInfo>(() => getDefaultAgent());
  const [activeProviderId, setActiveProviderId] = useState<string | undefined>(() =>
    getInitialModelProviderId(store, initialSession, config),
  );
  const effectiveModelProviders = getEffectiveProviders();
  const [prompt, setPrompt] = useState("");
  const [promptCursor, setPromptCursor] = useState(0);
  const promptHistoryRef = useRef<string[]>([]);
  const promptHistoryIndexRef = useRef<number | undefined>(undefined);
  const [slashSelectionIndex, setSlashSelectionIndex] = useState(0);
  const [messages, setMessages] = useState<TranscriptMessage[]>(() => [
    {
      id: "session-start",
      role: "system",
      parts: [
        {
          id: "session-start:status",
          type: "status",
          tone: "muted",
          text:
            initialSession.session === undefined
              ? "Draft session: a session will be saved after the first successful prompt."
              : `${initialSession.resumed ? "Resumed latest session" : "Started new session"}: ${initialSession.session.id}${initialSession.session.title ? ` (${initialSession.session.title})` : ""}`,
        },
      ],
    },
    ...(initialSession.session === undefined
      ? []
      : sessionEventsToTranscriptMessages(store.listEvents(initialSession.session.id), 30)),
  ]);
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>();
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
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

  useEffect(() => {
    setPromptCursor((cursor) => Math.min(cursor, prompt.length));
  }, [prompt.length]);

  useEffect(() => {
    setTranscriptScrollOffset((offset) =>
      Math.max(0, Math.min(getTranscriptMaxScrollOffset(messages, expandedMessageIds), offset)),
    );
    if (selectedMessageId === undefined && messages.length > 0) {
      setSelectedMessageId(messages.at(-1)?.id);
    }
  }, [messages, selectedMessageId, expandedMessageIds]);

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
    return `.magi/plans/${session?.id ?? providerSessionIdRef.current}.md`;
  }

  function isPlanFilePath(filePath: string): boolean {
    return filePath === getPlanFilePath();
  }

  useEffect(() => {
    return () => {
      store.close();
    };
  }, [store]);

  useInput(
    (input, key) => {
      if (pendingPermission) {
        if (input.toLowerCase() === "y") {
          void resolvePermission(true);
        } else if (input.toLowerCase() === "n" || key.escape) {
          void resolvePermission(false);
        }

        return;
      }

      if (pendingSelector) {
        if (key.escape) {
          setPendingSelector(undefined);
          return;
        }

        if (key.upArrow) {
          setPendingSelector((current) =>
            current
              ? {
                  ...current,
                  selectedIndex:
                    current.selectedIndex <= 0
                      ? current.items.length - 1
                      : current.selectedIndex - 1,
                }
              : current,
          );
          return;
        }

        if (key.downArrow) {
          setPendingSelector((current) =>
            current
              ? { ...current, selectedIndex: (current.selectedIndex + 1) % current.items.length }
              : current,
          );
          return;
        }

        if (key.return) {
          const selectedItem = pendingSelector.items[pendingSelector.selectedIndex];
          setPendingSelector(undefined);
          if (selectedItem) {
            pendingSelector.onSelect(selectedItem);
          }
          return;
        }

        return;
      }

      if (pendingQuestion) {
        const activeQuestion = pendingQuestion.questions[0];
        const optionCount = activeQuestion?.options.length ?? 0;

        if (key.escape) {
          resolveQuestion(undefined);
          return;
        }

        if (optionCount > 0 && key.upArrow) {
          setQuestionOptionIndex((index) => (index <= 0 ? optionCount - 1 : index - 1));
          return;
        }

        if (optionCount > 0 && key.downArrow) {
          setQuestionOptionIndex((index) => (index + 1) % optionCount);
          return;
        }

        if (optionCount > 0 && input === " ") {
          if (activeQuestion?.multiple) {
            setQuestionSelectedOptionIndexes((indexes) => {
              const next = new Set(indexes);
              if (next.has(questionOptionIndex)) {
                next.delete(questionOptionIndex);
              } else {
                next.add(questionOptionIndex);
              }
              return next;
            });
          } else {
            setQuestionSelectedOptionIndexes(new Set([questionOptionIndex]));
          }
          setQuestionAnswer("");
          return;
        }

        if (key.return) {
          resolveQuestion(readPendingQuestionAnswer());
          return;
        }

        if (key.backspace || key.delete) {
          setQuestionAnswer((currentAnswer) => currentAnswer.slice(0, -1));
          return;
        }

        if (input.length > 0 && !key.ctrl && !key.meta) {
          setQuestionAnswer((currentAnswer) => currentAnswer + input);
          setQuestionSelectedOptionIndexes(new Set());
        }

        return;
      }

      if ((input === "q" && prompt.length === 0) || key.escape || (input === "c" && key.ctrl)) {
        exit();
        return;
      }

      if (key.tab && slashCommandSuggestions.length > 0) {
        const selected = slashCommandSuggestions[slashSelectionIndex] ?? slashCommandSuggestions[0];
        if (selected) {
          const completed = `/${selected.name} `;
          setPromptWithCursor(completed);
        }
        return;
      }

      if (key.upArrow) {
        if (slashCommandSuggestions.length > 0) {
          setSlashSelectionIndex((index) =>
            index <= 0 ? slashCommandSuggestions.length - 1 : index - 1,
          );
          return;
        }
        showPreviousPromptHistory();
        return;
      }

      if (key.downArrow) {
        if (slashCommandSuggestions.length > 0) {
          setSlashSelectionIndex((index) => (index + 1) % slashCommandSuggestions.length);
          return;
        }
        showNextPromptHistory();
        return;
      }

      if (key.pageUp) {
        scrollTranscript(8);
        return;
      }

      if (key.pageDown) {
        scrollTranscript(-8);
        return;
      }

      if (key.home) {
        scrollTranscriptToStart();
        return;
      }

      if (key.end) {
        scrollTranscriptToEnd();
        return;
      }

      if (prompt.length === 0 && input === "k") {
        selectTranscriptMessage(-1);
        return;
      }

      if (prompt.length === 0 && input === "j") {
        selectTranscriptMessage(1);
        return;
      }

      if (prompt.length === 0 && (input === " " || key.return)) {
        toggleSelectedMessageExpansion();
        return;
      }

      if (key.leftArrow || (input === "b" && key.ctrl)) {
        setPromptCursor((cursor) => Math.max(0, cursor - 1));
        return;
      }

      if (key.rightArrow || (input === "f" && key.ctrl)) {
        setPromptCursor((cursor) => Math.min(prompt.length, cursor + 1));
        return;
      }

      if (input === "a" && key.ctrl) {
        setPromptCursor(0);
        return;
      }

      if (input === "e" && key.ctrl) {
        setPromptCursor(prompt.length);
        return;
      }

      if (input === "u" && key.ctrl) {
        setPromptWithCursor("");
        promptHistoryIndexRef.current = undefined;
        return;
      }

      if (input === "w" && key.ctrl) {
        deletePreviousPromptWord();
        return;
      }

      if (key.return) {
        const content = prompt.trim();

        if (content.length > 0) {
          setPromptWithCursor("");
          addPromptHistory(content);
          void handleSubmittedPrompt(content);
        }

        return;
      }

      if (key.backspace || key.delete) {
        deletePromptCharacter();
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        insertPromptText(input);
      }
    },
    {
      isActive: canReadInput,
    },
  );

  function setPromptWithCursor(nextPrompt: string, nextCursor: number = nextPrompt.length): void {
    setPrompt(nextPrompt);
    setPromptCursor(Math.max(0, Math.min(nextPrompt.length, nextCursor)));
    setSlashSelectionIndex(0);
  }

  function insertPromptText(text: string): void {
    const nextPrompt = `${prompt.slice(0, promptCursor)}${text}${prompt.slice(promptCursor)}`;
    setPromptWithCursor(nextPrompt, promptCursor + text.length);
    promptHistoryIndexRef.current = undefined;
  }

  function deletePromptCharacter(): void {
    if (promptCursor <= 0) return;
    const nextPrompt = `${prompt.slice(0, promptCursor - 1)}${prompt.slice(promptCursor)}`;
    setPromptWithCursor(nextPrompt, promptCursor - 1);
    promptHistoryIndexRef.current = undefined;
  }

  function deletePreviousPromptWord(): void {
    if (promptCursor <= 0) return;
    const beforeCursor = prompt.slice(0, promptCursor);
    const afterCursor = prompt.slice(promptCursor);
    const trimmedEnd = beforeCursor.replace(/\s+$/, "");
    const nextBeforeCursor = trimmedEnd.replace(/\S+$/, "");
    const nextPrompt = `${nextBeforeCursor}${afterCursor}`;
    setPromptWithCursor(nextPrompt, nextBeforeCursor.length);
    promptHistoryIndexRef.current = undefined;
  }

  function addPromptHistory(content: string): void {
    promptHistoryRef.current = [
      ...promptHistoryRef.current.filter((entry) => entry !== content),
      content,
    ].slice(-50);
    promptHistoryIndexRef.current = undefined;
  }

  function showPreviousPromptHistory(): void {
    if (promptHistoryRef.current.length === 0) return;
    const currentIndex = promptHistoryIndexRef.current ?? promptHistoryRef.current.length;
    const nextIndex = Math.max(0, currentIndex - 1);
    promptHistoryIndexRef.current = nextIndex;
    setPromptWithCursor(promptHistoryRef.current[nextIndex] ?? "");
  }

  function showNextPromptHistory(): void {
    const currentIndex = promptHistoryIndexRef.current;
    if (currentIndex === undefined) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= promptHistoryRef.current.length) {
      promptHistoryIndexRef.current = undefined;
      setPromptWithCursor("");
      return;
    }
    promptHistoryIndexRef.current = nextIndex;
    setPromptWithCursor(promptHistoryRef.current[nextIndex] ?? "");
  }

  function scrollTranscript(delta: number): void {
    setTranscriptScrollOffset((offset) => clampTranscriptScrollOffset(offset + delta));
  }

  function scrollTranscriptToStart(): void {
    setTranscriptScrollOffset(
      clampTranscriptScrollOffset(getTranscriptLineCount(messages, expandedMessageIds)),
    );
  }

  function scrollTranscriptToEnd(): void {
    setTranscriptScrollOffset(0);
  }

  function selectTranscriptMessage(direction: number): void {
    const selectableIds = getSelectableTranscriptIds(messages);
    if (selectableIds.length === 0) return;
    const currentIndex = selectedMessageId
      ? selectableIds.findIndex((id) => id === selectedMessageId)
      : selectableIds.length - 1;
    const normalizedIndex = currentIndex === -1 ? selectableIds.length - 1 : currentIndex;
    const nextIndex = Math.max(0, Math.min(selectableIds.length - 1, normalizedIndex + direction));
    const nextMessageId = selectableIds[nextIndex];
    setSelectedMessageId(nextMessageId);
    if (nextMessageId) {
      keepTranscriptMessageVisible(nextMessageId, expandedMessageIds);
    }
  }

  function toggleSelectedMessageExpansion(): void {
    if (!selectedMessageId) return;
    if (!isExpandableTranscriptId(messages, selectedMessageId)) return;
    setExpandedMessageIds((expandedIds) => {
      const next = new Set(expandedIds);
      if (next.has(selectedMessageId)) {
        next.delete(selectedMessageId);
      } else {
        next.add(selectedMessageId);
      }
      setTranscriptScrollOffset((offset) =>
        clampTranscriptScrollOffsetFor(
          next,
          keepTranscriptMessageOffsetVisible(selectedMessageId, next, offset),
        ),
      );
      return next;
    });
  }

  function clampTranscriptScrollOffset(offset: number): number {
    return clampTranscriptScrollOffsetFor(expandedMessageIds, offset);
  }

  function clampTranscriptScrollOffsetFor(expandedIds: Set<string>, offset: number): number {
    return Math.max(0, Math.min(getTranscriptMaxScrollOffset(messages, expandedIds), offset));
  }

  function keepTranscriptMessageVisible(messageId: string, expandedIds: Set<string>): void {
    setTranscriptScrollOffset((offset) =>
      clampTranscriptScrollOffset(
        keepTranscriptMessageOffsetVisible(messageId, expandedIds, offset),
      ),
    );
  }

  function keepTranscriptMessageOffsetVisible(
    messageId: string,
    expandedIds: Set<string>,
    offset: number,
  ): number {
    const range = getTranscriptMessageLineRange(messages, expandedIds, messageId);
    if (!range) return offset;

    const totalLines = getTranscriptLineCount(messages, expandedIds);
    const visibleEnd = totalLines - offset;
    const visibleStart = Math.max(0, visibleEnd - transcriptLineLimit);

    if (range.start < visibleStart) {
      return totalLines - Math.min(totalLines, range.start + transcriptLineLimit);
    }

    if (range.end > visibleEnd) {
      return totalLines - range.end;
    }

    return offset;
  }

  async function handleSubmittedPrompt(content: string): Promise<void> {
    if (content.startsWith("/")) {
      await handleCommand(content);
      return;
    }

    if (isBusy) {
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
      interruptionRequestedRef.current = true;
      appendSessionEvent({
        type: "interruption",
        payload: { reason: "user_cancelled", createdAt: new Date().toISOString() },
      });
      addMessage(
        "Interruption requested. Current provider/tool calls cannot be forcibly aborted yet; the run will stop at the next safe point.",
      );
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
    beginBusy();
    interruptionRequestedRef.current = false;

    try {
      const adapter = createPrimaryModelAdapter({
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
      const event = appendSessionEvent({
        type: "assistant_message",
        payload: {
          content: result.finalText,
          agentId: agent.id,
          providerId: adapter.provider?.id ?? providerId,
          model: adapter.provider?.model,
          agentTurn: true,
          status: result.status,
        },
      });
      persistDraftSessionIfNeeded(content, result.finalText);
      completeLatestAssistantMessage(event.id, truncate(result.finalText), agent, {
        providerId: adapter.provider?.id ?? providerId,
        model: adapter.provider?.model,
      });
    } catch (error) {
      if (!session) {
        draftEventsRef.current = [];
      }
      addMessage(`Agent error: ${formatError(error)}`);
    } finally {
      endBusy();
      void drainQueuedPrompts();
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
        return await runVerification(action.command ?? "", agent);
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
      setPendingQuestion({
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
    const accepted = answer?.trim() === "1" || answer?.toLowerCase() === "yes";
    appendSessionEvent({
      type: "plan_exit",
      payload: { planPath, accepted, answer: answer ?? "Unanswered" },
    });

    if (accepted) {
      const build = getAgent("build");
      if (build) setActiveAgent(build);
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

    const adapter = createPrimaryModelAdapter({
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
    if (!session) {
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
    const targetSessionId = session.id;
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

    void runBackgroundTaskToCompletion({
      action,
      parentAgent,
      providerId,
      subagent,
      targetSessionId,
      taskId,
      startedAt,
    });

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
  }): Promise<void> {
    try {
      const adapter = createPrimaryModelAdapter({
        ...config,
        selectedProviderId: input.providerId,
        sessionId: providerSessionIdRef.current,
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
        shouldInterrupt() {
          return false;
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
          );
        },
      });
      const endedAt = new Date().toISOString();
      store.appendEvent({
        sessionId: input.targetSessionId,
        type: "task_update",
        payload: {
          taskId: input.taskId,
          status: result.status === "completed" ? "completed" : "failed",
          description: input.action.description,
          subagentId: input.subagent.id,
          parentAgentId: input.parentAgent.id,
          startedAt: input.startedAt,
          endedAt,
          finalText: result.finalText,
        },
      });
      addMessage(`task background ${result.status}: ${input.action.description} (${input.taskId})`);
    } catch (error) {
      const endedAt = new Date().toISOString();
      store.appendEvent({
        sessionId: input.targetSessionId,
        type: "task_update",
        payload: {
          taskId: input.taskId,
          status: "failed",
          description: input.action.description,
          subagentId: input.subagent.id,
          parentAgentId: input.parentAgent.id,
          startedAt: input.startedAt,
          endedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      addMessage(`task background failed: ${input.action.description} (${input.taskId})`);
    }
  }

  async function executeBackgroundAgentAction(
    action: ExecutableAgentAction,
    agent: AgentInfo,
    targetSessionId: string,
  ): Promise<string> {
    const call = createToolCallForExecutableAction(action);

    if (!call) {
      return `${action.type} is not available in background tasks.`;
    }

    const result = await runBackgroundToolCall(call, agent, targetSessionId);

    return result ? toolResultToObservation(result) : `${call.name} did not run.`;
  }

  function createToolCallForExecutableAction(action: ExecutableAgentAction): ToolCall | undefined {
    const actionToolCall = (name: Parameters<typeof createToolCall>[0], input: unknown) =>
      createToolCall(name, input, action.toolCallId);

    switch (action.type) {
      case "read":
        return actionToolCall("read", { path: action.path });
      case "glob":
        return actionToolCall("glob", { pattern: action.pattern });
      case "grep":
        return actionToolCall("grep", {
          pattern: action.pattern,
          ...(action.include === undefined ? {} : { include: action.include }),
        });
      case "edit":
        return actionToolCall("edit", {
          filePath: action.filePath,
          oldString: action.oldString,
          newString: action.newString,
          ...(action.replaceAll === undefined ? {} : { replaceAll: action.replaceAll }),
        });
      case "write":
        return actionToolCall("write", { filePath: action.filePath, content: action.content });
      case "apply_patch":
        return actionToolCall("apply_patch", { patchText: action.patchText });
      case "webfetch":
        return actionToolCall("webfetch", {
          url: action.url,
          ...(action.format === undefined ? {} : { format: action.format }),
          ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
        });
      case "websearch":
        return actionToolCall("websearch", {
          query: action.query,
          ...(action.providerId === undefined ? {} : { providerId: action.providerId }),
          ...(action.limit === undefined ? {} : { limit: action.limit }),
          ...(action.searchType === undefined ? {} : { type: action.searchType }),
          ...(action.livecrawl === undefined ? {} : { livecrawl: action.livecrawl }),
          ...(action.contextMaxCharacters === undefined
            ? {}
            : { contextMaxCharacters: action.contextMaxCharacters }),
        });
      case "todowrite":
        return actionToolCall("todowrite", { todos: action.todos });
      case "skill":
        return actionToolCall("skill", { name: action.name });
      case "lsp_symbols":
        return actionToolCall("lsp_symbols", { filePath: action.filePath });
      case "lsp_definition":
      case "lsp_references":
      case "lsp_hover":
      case "lsp_call_hierarchy":
        return actionToolCall(action.type, {
          filePath: action.filePath,
          line: action.line,
          character: action.character,
          ...(action.type === "lsp_call_hierarchy" && action.direction !== undefined
            ? { direction: action.direction }
            : {}),
        });
      case "verify":
        return actionToolCall("bash", { command: action.command ?? "" });
      case "question":
      case "task":
      case "plan_exit":
      case "propose_patch":
      case "invalid_tool":
        return undefined;
    }
  }

  async function runBackgroundToolCall(
    call: ToolCall,
    agent: AgentInfo,
    targetSessionId: string,
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

    const result = await runTool(call, { workspaceRoot: config.workspaceRoot });
    if (result.ok && call.name === "todowrite") {
      const nextTodos = readTodosFromToolInput(call.input);
      store.appendEvent({
        sessionId: targetSessionId,
        type: "todo_update",
        payload: { todos: nextTodos, background: true },
      });
      if (session?.id === targetSessionId) {
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
    addMessage(formatToolResultMessage(result, call.input));

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
    return result.ok ? result.output || "ok" : `failed: ${result.error}`;
  }

  async function runToolWithPermission(
    call: ToolCall,
    agent: AgentInfo = activeAgent,
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
        setPendingPermission({
          call,
          description: `${call.name}: ${JSON.stringify(call.input)}`,
          resolve,
        });
        addMessage(`Allow ${call.name}? Press y to allow or n to deny.`);
      });

      appendSessionEvent({
        type: "permission_decision",
        payload: { toolCallId: call.id, action: permission, decision: allow ? "allow" : "deny" },
      });
      setPendingPermission(undefined);

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

    return await executeToolCall(call, agent);
  }

  function resolvePermission(allow: boolean): void {
    if (!pendingPermission) {
      return;
    }

    pendingPermission.resolve(allow);
  }

  function resolveQuestion(answer: string | undefined): void {
    if (!pendingQuestion) {
      return;
    }

    pendingQuestion.resolve(answer);
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
  ): Promise<ToolResult> {
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
      const result =
        call.name === "question"
          ? await runInteractiveQuestionTool(call)
          : await runTool(call, { workspaceRoot: config.workspaceRoot });
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
        setPendingQuestion({ call, questions, resolve });
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
      setPendingQuestion(undefined);
      setQuestionAnswer("");
      setQuestionOptionIndex(0);
      setQuestionSelectedOptionIndexes(new Set());
    }
  }

  async function runVerification(command: string, agent: AgentInfo = activeAgent): Promise<string> {
    if (mergeAgentPermission(agent, config.permissions).shell === "deny") {
      const message = `${agent.id} agent cannot run verification because shell permission is denied.`;
      addMessage(message);
      return message;
    }

    beginBusy();

    try {
      const results = await runVerificationCommands({
        commands: command.length > 0 ? [command] : config.verificationCommands,
        cwd: config.workspaceRoot,
      });

      for (const result of results) {
        appendSessionEvent({
          type: "verification_result",
          payload: { ...result, agentId: agent.id },
        });
        addMessage(`verify: ${result.command}: ${result.status}`);
      }

      return results
        .map((result) =>
          [
            `${result.command}: ${result.status} (exit ${result.exitCode}, ${result.durationMs}ms)`,
            result.stdout ? `stdout:\n${truncate(result.stdout)}` : "stdout: (empty)",
            result.stderr ? `stderr:\n${truncate(result.stderr)}` : "stderr: (empty)",
          ].join("\n"),
        )
        .join("\n\n");
    } finally {
      endBusy();
    }
  }

  async function runSummary(): Promise<void> {
    if (!session) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const summary = summarizeWorkspace({
      workspaceRoot: config.workspaceRoot,
      events: store.listEvents(session.id),
    });
    appendSessionEvent({ type: "summary", payload: summary });
    addMessage(summary.text);
  }

  async function reviseFromVerificationFailures(): Promise<void> {
    if (!session) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    beginBusy();

    try {
      const context = buildRevisionContext({
        workspaceRoot: config.workspaceRoot,
        events: store.listEvents(session.id),
      });

      if (context.verificationFailures.length === 0) {
        addMessage("No verification failures found. Run /verify first.");
        return;
      }

      const adapter = createPrimaryModelAdapter(config);
      const response = await adapter.generateText({
        system:
          "You are MAGI revising a local code change. Use the provided verification failures and changed files. Suggest the smallest correct fix. If a patch is appropriate, provide a git-apply-compatible unified diff inside a ```diff fenced code block. Do not claim you ran commands.",
        prompt: context.text,
      });
      const event = appendSessionEvent({
        type: "assistant_message",
        payload: { content: response.text, revision: true },
      });
      saveProposedPatch(event.id, response.text);
      addMessage(`Revision: ${truncate(response.text)}`, event.id);
    } catch (error) {
      addMessage(`Revision error: ${formatError(error)}`);
    } finally {
      endBusy();
    }
  }

  async function applyLastProposedPatch(): Promise<void> {
    if (!session) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const patch = getLatestProposedPatch(store.listEvents(session.id));

    if (!patch) {
      addMessage("No proposed patch found. Run /revise first.");
      return;
    }

    await runToolWithPermission(createToolCall("apply_patch", { patch }));
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
    if (!session) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    beginBusy();
    try {
      const events = store.listEvents(session.id);
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
      const catalogResult = await getModelsDevCatalogResult();
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
      addMessage(`MAGI preview error: ${formatError(error)}`);
    } finally {
      endBusy();
    }
  }

  async function getModelsDevCatalogResult(): Promise<{
    catalog?: Awaited<ReturnType<typeof loadModelsDevCatalog>>;
    summary: string;
  }> {
    try {
      const catalog = await loadModelsDevCatalog({ workspaceRoot: config.workspaceRoot });
      const providers = Object.values(catalog);
      const modelCount = providers.reduce(
        (count, provider) => count + Object.keys(provider.models).length,
        0,
      );
      return { catalog, summary: `${providers.length} providers, ${modelCount} models` };
    } catch (error) {
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
    setSession(selectedSession);
    providerSessionIdRef.current = selectedSession.id;
    setTodos(getLatestTodos(selectedEvents));
    setActiveProviderId(
      getLatestModelSelection({
        events: selectedEvents,
        modelProviders: getEffectiveModelProviderSummaries({
          configProviders: config.modelProviders,
          workspaceRoot: config.workspaceRoot,
        }),
      })?.providerId,
    );
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

    draftEventsRef.current = [];
    providerSessionIdRef.current = crypto.randomUUID();
    setActiveProviderId(
      getDefaultModelSelection({ modelProviders: effectiveModelProviders })?.providerId,
    );
    setSession(undefined);
    setTodos([]);
    setMessages([
      createSystemMessage(
        "Started a new draft session. It will be saved after the first successful prompt.",
      ),
    ]);
  }

  function renameCurrentSession(title: string): void {
    if (!session) {
      addMessage(
        "No saved session to rename. Run a normal prompt first, or /resume an existing session.",
      );
      return;
    }

    if (title.length === 0) {
      addMessage("Usage: /rename <title>");
      return;
    }

    const updatedSession = store.updateSession({ sessionId: session.id, title });
    setSession(updatedSession);
    addMessage(`Renamed session: ${title}`);
  }

  function showHistory(rawLimit: string | undefined): void {
    if (!session) {
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

    const events = store.listEvents(session.id).slice(-limit);
    addMessage(
      [
        `Recent history (${events.length} events):`,
        ...events.map((event) => `${event.sequence}. ${event.type}: ${formatEventPayload(event)}`),
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

      beginBusy();

      try {
        const refreshed = await refreshOpenAICodexAuth({
          workspaceRoot: config.workspaceRoot,
          auth,
        });
        addMessage(`OpenAI OAuth refreshed. Expires: ${new Date(refreshed.expires).toISOString()}`);
      } catch (error) {
        addMessage(`OpenAI OAuth refresh failed. Run /auth login openai. ${formatError(error)}`);
      } finally {
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

    beginBusy();

    try {
      if (mode === "headless") {
        const auth = await loginOpenAICodexHeadless({
          workspaceRoot: config.workspaceRoot,
          onUserCode({ url, code }) {
            addMessage(`Open ${url} and enter code: ${code}`);
          },
        });
        addMessage(`OpenAI OAuth login complete. Account: ${auth.accountId ?? "unknown"}`);
        return;
      }

      const auth = await loginOpenAICodexBrowser({
        workspaceRoot: config.workspaceRoot,
        openUrl(url) {
          addMessage(`Opening browser for OpenAI OAuth: ${url}`);
          openExternalUrl(url);
        },
      });
      addMessage(`OpenAI OAuth login complete. Account: ${auth.accountId ?? "unknown"}`);
    } catch (error) {
      addMessage(`OpenAI OAuth login failed: ${formatError(error)}`);
    } finally {
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
    if (isBusy || pendingPermission) {
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
        `Session: ${session?.id ?? "draft"}`,
        `Queued prompts: ${queuedPromptsRef.current.length}`,
      ].join("\n"),
    );
  }

  function switchModelProvider(providerId: string): void {
    if (isBusy || pendingPermission) {
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

    if (isBusy || pendingPermission) {
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
      type: "summary",
      payload: { text: `Switched agent to ${agent.id}.`, agentSwitch: true, agentId: agent.id },
    });
    addMessage(`Switched agent: ${agent.id}`);
    return agent;
  }

  function showAgentSelectorOrSwitch(agentId: string): AgentInfo | undefined {
    if (agentId.length > 0) {
      return switchAgent(agentId);
    }

    if (isBusy || pendingPermission) {
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

  async function drainQueuedPrompts(): Promise<void> {
    if (queuedPromptsRef.current.length === 0 || busyDepth > 1 || pendingPermission) {
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
    status: "pending" | "running" | "succeeded" | "failed" | "denied",
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
    if (isBusy || pendingPermission) {
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
    if (session) {
      return store.appendEvent({ sessionId: session.id, type: input.type, payload: input.payload });
    }

    const event = {
      type: input.type,
      payload: input.payload,
    } satisfies AppendSessionEventInput;
    const result = appendDraftSessionEvent({ draftEvents: draftEventsRef.current, event });
    draftEventsRef.current = result.draftEvents;

    return result.event;
  }

  function getCurrentSessionEvents(): SessionEvent[] {
    if (session) {
      return store.listEvents(session.id);
    }

    return draftEventsToSessionEvents(draftEventsRef.current);
  }

  function persistDraftSessionIfNeeded(userMessage: string, assistantMessage: string): void {
    if (session || draftEventsRef.current.length === 0) {
      return;
    }

    const result = persistDraftSession({
      session,
      store,
      draftEvents: draftEventsRef.current,
      userMessage,
      assistantMessage,
      createTitle: createSessionTitle,
    });

    if (!result.persisted) return;

    draftEventsRef.current = [];
    setSession(result.session);
    addMessage(`Saved session: ${result.session.id} (${result.title})`);
  }

  function requirePersistedSession(message: string): boolean {
    if (session) {
      return true;
    }

    addMessage(message);
    return false;
  }

  function addMessage(content: string, id: string = crypto.randomUUID()): void {
    addTranscriptMessage(createSystemMessage(content, id));
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
      offset === 0 ? 0 : offset + getTranscriptMessageLineCount(message, expandedMessageIds),
    );
  }

  function upsertTranscriptMessage(message: TranscriptMessage): void {
    setMessages((currentMessages) => {
      const index = currentMessages.findIndex((candidate) => candidate.id === message.id);
      if (index === -1) return [...currentMessages, message];

      return currentMessages.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, ...message } : candidate,
      );
    });
    setSelectedMessageId(message.id);
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
        const hasText = message.parts.some((part) => part.type === "text" && !part.synthetic);
        const parts =
          finalText.trim().length > 0 && !hasText
            ? [
                ...message.parts,
                { id: `${messageId}:final-text`, type: "text" as const, text: finalText },
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
    setBusyDepth((currentDepth) => currentDepth + 1);
  }

  function endBusy(): void {
    setBusyDepth((currentDepth) => Math.max(0, currentDepth - 1));
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

function createSystemMessage(content: string, id: string = crypto.randomUUID()): TranscriptMessage {
  return {
    id,
    role: "system",
    createdAt: Date.now(),
    parts: [{ id: `${id}:status`, type: "status", text: content, tone: "muted" }],
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

function upsertTranscriptPart(message: TranscriptMessage, part: TranscriptPart): TranscriptMessage {
  const index = message.parts.findIndex((candidate) => candidate.id === part.id);
  if (index === -1) return { ...message, parts: [...message.parts, part] };

  return {
    ...message,
    parts: message.parts.map((candidate, candidateIndex) =>
      candidateIndex === index ? mergeTranscriptPart(candidate, part) : candidate,
    ),
  };
}

function mergeTranscriptPart(existing: TranscriptPart, next: TranscriptPart): TranscriptPart {
  if (existing.type === "tool" && next.type === "tool") {
    return {
      ...existing,
      ...next,
      state: {
        ...existing.state,
        ...next.state,
        metadata: { ...existing.state.metadata, ...next.state.metadata },
        time: {
          start: existing.state.time.start,
          end: next.state.time.end ?? existing.state.time.end,
        },
      },
    };
  }
  if (existing.type === "reasoning" && next.type === "reasoning") {
    return {
      ...existing,
      ...next,
      time: { start: existing.time.start, end: next.time.end ?? existing.time.end },
    };
  }
  return next;
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

function parseJsonInput(value: string | undefined): unknown {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatToolInputTarget(toolName: string, input: unknown): string | undefined {
  switch (toolName) {
    case "bash":
      return readInputString(input, "command");
    case "read":
      return readInputString(input, "filePath") ?? readInputString(input, "path");
    case "grep":
    case "glob":
      return readInputString(input, "pattern");
    case "webfetch":
      return readInputString(input, "url");
    case "websearch":
      return readInputString(input, "query");
    case "write":
    case "edit":
      return readInputString(input, "filePath");
    case "task":
      return readInputString(input, "description");
    default:
      return undefined;
  }
}

function createToolPartFromInput(
  id: string,
  toolName: string,
  input: unknown,
  status: "pending" | "running",
  startedAtMs: number,
): TranscriptPart {
  const target = formatToolInputTarget(toolName, input);
  return {
    id,
    type: "tool",
    tool: toolName,
    state: {
      status,
      input,
      metadata: target ? { target } : undefined,
      time: { start: startedAtMs },
    },
  };
}

function findToolInput(messages: TranscriptMessage[], toolCallId: string): unknown {
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "tool" && part.id === `tool:${toolCallId}`) return part.state.input;
    }
  }

  return undefined;
}

function findMatchingToolPartId(
  message: TranscriptMessage,
  toolName: string,
  input: unknown,
  toolCallId?: string,
): string {
  const preferredId = toolCallId === undefined ? undefined : `tool:${toolCallId}`;
  if (preferredId !== undefined && message.parts.some((part) => part.id === preferredId)) {
    return preferredId;
  }

  const matchingPart = message.parts.find(
    (part): part is Extract<TranscriptPart, { type: "tool" }> =>
      part.type === "tool" && part.tool === toolName && toolInputsEqual(part.state.input, input),
  );

  return matchingPart?.id ?? preferredId ?? `tool:${toolName}:${stableStringify(input)}`;
}

function isSameToolPart(
  part: TranscriptPart,
  call: Pick<ToolCall, "id" | "name" | "input">,
): boolean {
  if (part.type !== "tool") return false;
  if (part.id === `tool:${call.id}`) return true;
  if (part.tool !== call.name) return false;

  return toolInputsEqual(part.state.input, call.input);
}

function toolInputsEqual(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

function formatUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
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
  status: "pending" | "running" | "succeeded" | "failed" | "denied",
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

function createInitialSession(
  store: SessionStore,
  config: ReturnType<typeof loadConfig>,
): InitialSessionState {
  if (config.session.startup === "resume") {
    const latestSession = store.getLatestSession({ workspaceRoot: config.workspaceRoot });

    if (latestSession) {
      return { session: latestSession, resumed: true };
    }
  }

  return { resumed: false };
}

function getInitialModelProviderId(
  store: SessionStore,
  initialSession: InitialSessionState,
  config: ReturnType<typeof loadConfig>,
): string | undefined {
  const events = initialSession.session ? store.listEvents(initialSession.session.id) : [];
  const selection = getLatestModelSelection({
    events,
    modelProviders: getEffectiveModelProviderSummaries({
      configProviders: config.modelProviders,
      workspaceRoot: config.workspaceRoot,
    }),
  });

  return selection?.providerId;
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

function sessionEventsToTranscriptMessages(
  events: SessionEvent[],
  limit: number,
): TranscriptMessage[] {
  const messages: TranscriptMessage[] = [];
  let currentAssistantId: string | undefined;
  const reasoningStarts = new Map<string, number>();
  const reasoningTexts = new Map<string, string>();
  const toolInputs = new Map<
    string,
    { toolName: string; raw: string; input?: unknown; startedAt: number }
  >();

  const appendSystem = (text: string, id: string) => messages.push(createSystemMessage(text, id));
  const ensureAssistant = (
    id: string,
    payload?: { agentId?: unknown; providerId?: unknown; model?: unknown },
  ) => {
    let message = messages.find((candidate) => candidate.id === id);
    if (!message) {
      message = {
        id,
        role: "assistant",
        agentId: typeof payload?.agentId === "string" ? payload.agentId : undefined,
        providerId: typeof payload?.providerId === "string" ? payload.providerId : undefined,
        model: typeof payload?.model === "string" ? payload.model : undefined,
        createdAt: Date.parse(
          events.find((event) => event.id === id)?.createdAt ?? new Date().toISOString(),
        ),
        parts: [],
      };
      messages.push(message);
    }
    currentAssistantId = id;
    return message;
  };
  const updateAssistant = (
    id: string,
    part: TranscriptPart,
    payload?: { agentId?: unknown; providerId?: unknown; model?: unknown },
  ) => {
    const message = ensureAssistant(id, payload);
    const updated = upsertTranscriptPart(message, part);
    const index = messages.findIndex((candidate) => candidate.id === id);
    messages[index] = updated;
  };

  for (const event of events) {
    switch (event.type) {
      case "user_message": {
        const payload = event.payload as {
          content?: unknown;
          agentId?: unknown;
          providerId?: unknown;
        };
        if (typeof payload.content !== "string") break;
        messages.push({
          id: `${event.id}-user`,
          role: "user",
          agentId: typeof payload.agentId === "string" ? payload.agentId : undefined,
          providerId: typeof payload.providerId === "string" ? payload.providerId : undefined,
          createdAt: Date.parse(event.createdAt),
          parts: [{ id: `${event.id}-text`, type: "text", text: truncate(payload.content) }],
        });
        break;
      }
      case "agent_step_started":
      case "assistant_started": {
        const payload = event.payload as {
          runId?: unknown;
          stepId?: unknown;
          agentId?: unknown;
          providerId?: unknown;
          model?: unknown;
        };
        if (typeof payload.runId === "string" && typeof payload.stepId === "string") {
          ensureAssistant(`assistant:${payload.runId}:${payload.stepId}`, payload);
        }
        break;
      }
      case "assistant_status": {
        const payload = event.payload as {
          runId?: unknown;
          stepId?: unknown;
          text?: unknown;
          kind?: unknown;
          agentId?: unknown;
        };
        if (typeof payload.text !== "string") break;
        const id =
          typeof payload.runId === "string" && typeof payload.stepId === "string"
            ? `assistant:${payload.runId}:${payload.stepId}`
            : (currentAssistantId ?? event.id);
        updateAssistant(
          id,
          payload.kind === "reasoning"
            ? {
                id: `${event.id}:reasoning`,
                type: "reasoning",
                text: payload.text,
                time: { start: Date.parse(event.createdAt), end: Date.parse(event.createdAt) },
              }
            : { id: `${event.id}:status`, type: "status", text: payload.text, tone: "muted" },
          payload,
        );
        break;
      }
      case "assistant_stream": {
        const payload = event.payload as {
          runId?: unknown;
          stepId?: unknown;
          kind?: unknown;
          id?: unknown;
          toolName?: unknown;
          input?: unknown;
          finishReason?: unknown;
          agentId?: unknown;
          text?: unknown;
          delta?: unknown;
        };
        if (typeof payload.runId !== "string" || typeof payload.stepId !== "string") break;
        const id = `assistant:${payload.runId}:${payload.stepId}`;
        if (payload.kind === "text_delta" && typeof payload.text === "string") {
          const message = ensureAssistant(id, payload);
          const existing = message.parts.find(
            (part): part is Extract<TranscriptPart, { type: "text" }> =>
              part.type === "text" && part.id === `${id}:text`,
          );
          updateAssistant(
            id,
            {
              id: `${id}:text`,
              type: "text",
              text: `${existing?.text ?? ""}${payload.text}`,
            },
            payload,
          );
        } else if (payload.kind === "reasoning_start" && typeof payload.id === "string") {
          reasoningStarts.set(payload.id, Date.parse(event.createdAt));
          reasoningTexts.set(payload.id, "");
          updateAssistant(
            id,
            {
              id: `reasoning:${payload.id}`,
              type: "reasoning",
              text: "",
              time: { start: Date.parse(event.createdAt) },
            },
            payload,
          );
        } else if (
          payload.kind === "reasoning_delta" &&
          typeof payload.id === "string" &&
          typeof payload.text === "string"
        ) {
          const text = `${reasoningTexts.get(payload.id) ?? ""}${payload.text}`;
          reasoningTexts.set(payload.id, text);
          updateAssistant(
            id,
            {
              id: `reasoning:${payload.id}`,
              type: "reasoning",
              text,
              time: { start: reasoningStarts.get(payload.id) ?? Date.parse(event.createdAt) },
            },
            payload,
          );
        } else if (payload.kind === "reasoning_end" && typeof payload.id === "string") {
          updateAssistant(
            id,
            {
              id: `reasoning:${payload.id}`,
              type: "reasoning",
              text: reasoningTexts.get(payload.id) ?? "",
              time: {
                start: reasoningStarts.get(payload.id) ?? Date.parse(event.createdAt),
                end: Date.parse(event.createdAt),
              },
            },
            payload,
          );
        } else if (
          payload.kind === "tool_input_start" &&
          typeof payload.id === "string" &&
          typeof payload.toolName === "string"
        ) {
          toolInputs.set(payload.id, {
            toolName: payload.toolName,
            raw: "",
            startedAt: Date.parse(event.createdAt),
          });
          updateAssistant(
            id,
            createToolPartFromInput(
              `tool:${payload.id}`,
              payload.toolName,
              undefined,
              "pending",
              Date.parse(event.createdAt),
            ),
            payload,
          );
        } else if (
          payload.kind === "tool_input_delta" &&
          typeof payload.id === "string" &&
          typeof payload.delta === "string"
        ) {
          const current = toolInputs.get(payload.id) ?? {
            toolName: "tool",
            raw: "",
            startedAt: Date.parse(event.createdAt),
          };
          const raw = `${current.raw}${payload.delta}`;
          const input = parseJsonInput(raw);
          toolInputs.set(payload.id, { ...current, raw, input });
          updateAssistant(
            id,
            createToolPartFromInput(
              `tool:${payload.id}`,
              current.toolName,
              input,
              "pending",
              current.startedAt,
            ),
            payload,
          );
        } else if (payload.kind === "tool_input_end" && typeof payload.id === "string") {
          const current = toolInputs.get(payload.id);
          if (current) {
            updateAssistant(
              id,
              createToolPartFromInput(
                `tool:${payload.id}`,
                current.toolName,
                current.input ?? parseJsonInput(current.raw),
                "pending",
                current.startedAt,
              ),
              payload,
            );
          }
        } else if (
          payload.kind === "tool_call" &&
          typeof payload.id === "string" &&
          typeof payload.toolName === "string"
        ) {
          updateAssistant(
            id,
            createToolPartFromInput(
              `tool:${payload.id}`,
              payload.toolName,
              payload.input,
              "running",
              Date.parse(event.createdAt),
            ),
            payload,
          );
        } else if (payload.kind === "finish_step") {
          updateAssistant(
            id,
            {
              id: `${event.id}:status`,
              type: "status",
              text: `model step finished${typeof payload.finishReason === "string" ? `: ${payload.finishReason}` : ""}`,
              tone: "muted",
            },
            payload,
          );
        }
        break;
      }
      case "agent_tool_skipped": {
        const payload = event.payload as {
          runId?: unknown;
          stepId?: unknown;
          toolCallId?: unknown;
          toolName?: unknown;
          input?: unknown;
          reason?: unknown;
          agentId?: unknown;
        };
        if (
          typeof payload.runId !== "string" ||
          typeof payload.stepId !== "string" ||
          typeof payload.toolName !== "string"
        ) {
          break;
        }
        const assistantId = `assistant:${payload.runId}:${payload.stepId}`;
        const toolCallId = typeof payload.toolCallId === "string" ? payload.toolCallId : undefined;
        const message = ensureAssistant(assistantId, payload);
        updateAssistant(
          assistantId,
          {
            id: findMatchingToolPartId(message, payload.toolName, payload.input, toolCallId),
            type: "tool",
            tool: payload.toolName,
            state: {
              status: "skipped",
              input: payload.input,
              error: typeof payload.reason === "string" ? payload.reason : undefined,
              title: "skipped repeated action",
              metadata: {
                target: formatToolInputTarget(payload.toolName, payload.input),
                ...(typeof payload.reason === "string" ? { summary: payload.reason } : {}),
              },
              time: { start: Date.parse(event.createdAt), end: Date.parse(event.createdAt) },
            },
          },
          payload,
        );
        break;
      }
      case "assistant_message": {
        const payload = event.payload as {
          content?: unknown;
          agentId?: unknown;
          providerId?: unknown;
          model?: unknown;
        };
        if (typeof payload.content !== "string") break;
        const id = currentAssistantId ?? event.id;
        updateAssistant(
          id,
          { id: `${event.id}:text`, type: "text", text: truncate(payload.content) },
          payload,
        );
        const message = messages.find((candidate) => candidate.id === id);
        if (message) message.completedAt = Date.parse(event.createdAt);
        break;
      }
      case "tool_call": {
        const payload = event.payload as { id?: unknown; name?: unknown; input?: unknown };
        if (typeof payload.id !== "string" || typeof payload.name !== "string") break;
        updateAssistant(
          currentAssistantId ?? `assistant:${event.id}`,
          createToolPartFromInput(
            `tool:${payload.id}`,
            payload.name,
            payload.input,
            "running",
            Date.parse(event.createdAt),
          ),
        );
        break;
      }
      case "tool_result": {
        const payload = event.payload as {
          id?: unknown;
          name?: unknown;
          ok?: unknown;
          output?: unknown;
          error?: unknown;
        };
        if (
          typeof payload.id !== "string" ||
          typeof payload.name !== "string" ||
          typeof payload.ok !== "boolean" ||
          typeof payload.output !== "string"
        )
          break;
        const input = findToolInput(messages, payload.id);
        const result = {
          id: payload.id,
          name: payload.name as ToolResult["name"],
          ok: payload.ok,
          output: payload.output,
          error: typeof payload.error === "string" ? payload.error : undefined,
        };
        const summary = formatToolResultSummary(result, input);
        updateAssistant(currentAssistantId ?? `assistant:${event.id}`, {
          id: `tool:${payload.id}`,
          type: "tool",
          tool: payload.name,
          state: {
            status: payload.ok ? "completed" : "error",
            input,
            output: payload.ok ? payload.output.trim() : undefined,
            error: payload.ok
              ? undefined
              : typeof payload.error === "string"
                ? payload.error
                : payload.output,
            title: summary.content,
            metadata: {
              ...(summary.target ? { target: summary.target } : {}),
              ...(summary.countLabel ? { countLabel: summary.countLabel } : {}),
              ...(summary.summary ? { summary: summary.summary } : {}),
              ...(summary.preview ? { preview: summary.preview } : {}),
            },
            time: { start: Date.parse(event.createdAt), end: Date.parse(event.createdAt) },
          },
        });
        break;
      }
      case "tool_settlement":
      case "verification_result":
      case "model_switch":
      case "todo_update":
      case "task_update":
      case "plan_exit":
      case "summary": {
        appendSystem(formatEventPayload(event), event.id);
        break;
      }
    }
  }

  return messages.slice(-limit);
}

function getTranscriptMaxScrollOffset(
  messages: TranscriptMessage[],
  expandedIds: Set<string>,
): number {
  return Math.max(0, getTranscriptLineCount(messages, expandedIds) - transcriptLineLimit);
}

function getTranscriptLineCount(messages: TranscriptMessage[], expandedIds: Set<string>): number {
  return messages.reduce(
    (count, message) => count + getTranscriptMessageLineCount(message, expandedIds),
    0,
  );
}

function getTranscriptMessageLineRange(
  messages: TranscriptMessage[],
  expandedIds: Set<string>,
  messageId: string,
): { start: number; end: number } | undefined {
  let start = 0;

  for (const message of messages) {
    const lineCount = getTranscriptMessageLineCount(message, expandedIds);
    const end = start + lineCount;
    if (message.id === messageId || message.parts.some((part) => part.id === messageId)) {
      return { start, end };
    }

    start = end;
  }

  return undefined;
}

function getTranscriptMessageLineCount(
  message: TranscriptMessage,
  expandedIds: Set<string>,
): number {
  const spacer = 1;
  if (message.role === "user" || message.role === "system") {
    return (
      spacer +
      message.parts.reduce(
        (count, part) => count + getTranscriptPartLineCount(part, expandedIds),
        0,
      )
    );
  }

  return (
    spacer +
    message.parts.reduce((count, part) => count + getTranscriptPartLineCount(part, expandedIds), 1)
  );
}

function getTranscriptPartLineCount(part: TranscriptPart, expandedIds: Set<string>): number {
  if (part.type === "text") return splitDisplayLines(part.text).length;
  if (part.type === "status") return splitDisplayLines(part.text).length;
  if (part.type === "reasoning") {
    return 1 + (expandedIds.has(part.id) ? splitDisplayLines(part.text).length : 0);
  }

  const metadataLines = [
    part.state.metadata?.countLabel,
    part.state.metadata?.summary,
    part.state.metadata?.preview,
  ].filter((value): value is string => typeof value === "string" && value.length > 0).length;
  const detailLines = expandedIds.has(part.id)
    ? [part.state.input, part.state.output, part.state.error]
        .filter((value) => value !== undefined && value !== "")
        .reduce<number>(
          (count, value) => count + splitDisplayLines(formatUnknown(value)).length + 1,
          0,
        )
    : 0;

  return 1 + metadataLines + detailLines;
}

function splitDisplayLines(value: string): string[] {
  const lines = value.split("\n");
  return lines.length === 0 ? [""] : lines;
}

function getSelectableTranscriptIds(messages: TranscriptMessage[]): string[] {
  return messages.flatMap((message) => {
    const ids = [message.id];
    ids.push(
      ...message.parts
        .filter((part) => part.type === "reasoning" || part.type === "tool")
        .map((part) => part.id),
    );
    return ids;
  });
}

function isExpandableTranscriptId(messages: TranscriptMessage[], id: string): boolean {
  return messages.some((message) =>
    message.parts.some(
      (part) => (part.type === "reasoning" || part.type === "tool") && part.id === id,
    ),
  );
}

function formatEventPayload(event: SessionEvent): string {
  switch (event.type) {
    case "user_message":
    case "assistant_message": {
      const payload = event.payload as { content?: unknown };

      return typeof payload.content === "string" ? truncateOneLine(payload.content) : "(invalid)";
    }
    case "tool_call": {
      const payload = event.payload as { name?: unknown };

      return typeof payload.name === "string" ? payload.name : "tool";
    }
    case "tool_result": {
      const payload = event.payload as {
        name?: unknown;
        ok?: unknown;
        output?: unknown;
        error?: unknown;
      };
      const name = typeof payload.name === "string" ? payload.name : "tool";

      if (payload.ok !== true) {
        return `${name}: failed${typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : ""}`;
      }

      return `${name}: ${formatOutputSummary(typeof payload.output === "string" ? payload.output : "")}`;
    }
    case "tool_settlement": {
      const payload = event.payload as { name?: unknown; status?: unknown; error?: unknown };
      const name = typeof payload.name === "string" ? payload.name : "tool";
      const status = typeof payload.status === "string" ? payload.status : "unknown";

      return `${name}: ${status}${typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : ""}`;
    }
    case "agent_step_started": {
      const payload = event.payload as { reason?: unknown };

      return `step started: ${String(payload.reason ?? "unknown")}`;
    }
    case "assistant_started":
      return "assistant started";
    case "assistant_status": {
      const payload = event.payload as { kind?: unknown; text?: unknown };
      const kind = typeof payload.kind === "string" ? payload.kind : "status";

      return typeof payload.text === "string" ? `${kind}: ${truncateOneLine(payload.text)}` : kind;
    }
    case "assistant_stream": {
      const payload = event.payload as { kind?: unknown; toolName?: unknown; text?: unknown };
      const kind = typeof payload.kind === "string" ? payload.kind : "stream";
      const toolName = typeof payload.toolName === "string" ? ` ${payload.toolName}` : "";
      const text = typeof payload.text === "string" ? `: ${truncateOneLine(payload.text)}` : "";

      return `${kind}${toolName}${text}`;
    }
    case "agent_tool_skipped": {
      const payload = event.payload as { toolName?: unknown; reason?: unknown };
      const toolName = typeof payload.toolName === "string" ? payload.toolName : "tool";
      const reason =
        typeof payload.reason === "string" ? `: ${truncateOneLine(payload.reason)}` : "";

      return `${toolName}: skipped${reason}`;
    }
    case "agent_step_ended": {
      const payload = event.payload as { status?: unknown };

      return `step ended: ${String(payload.status ?? "unknown")}`;
    }
    case "provider_error": {
      const payload = event.payload as { message?: unknown };

      return typeof payload.message === "string"
        ? truncateOneLine(payload.message)
        : "provider error";
    }
    case "interruption": {
      const payload = event.payload as { reason?: unknown };

      return `interrupted: ${String(payload.reason ?? "unknown")}`;
    }
    case "context_summary":
      return "context summary";
    case "queued_user_input": {
      const payload = event.payload as { content?: unknown; mode?: unknown };

      return `${String(payload.mode ?? "queued")}: ${typeof payload.content === "string" ? truncateOneLine(payload.content) : "input"}`;
    }
    case "verification_result": {
      const payload = event.payload as { command?: unknown; status?: unknown };

      return `${typeof payload.command === "string" ? payload.command : "unknown"}: ${typeof payload.status === "string" ? payload.status : "unknown"}`;
    }
    case "permission_decision": {
      const payload = event.payload as { action?: unknown; decision?: unknown };

      return `${String(payload.action ?? "permission")}: ${String(payload.decision ?? "unknown")}`;
    }
    case "proposed_patch": {
      const payload = event.payload as { summary?: unknown };

      return typeof payload.summary === "string" ? truncateOneLine(payload.summary) : "patch saved";
    }
    case "summary":
      return "workspace summary";
    case "model_switch": {
      const payload = event.payload as { providerId?: unknown; model?: unknown };

      return `${String(payload.providerId ?? "unknown")}: ${String(payload.model ?? "unknown")}`;
    }
    case "todo_update":
      return `${countOpenTodos(readTodosFromPayload(event.payload))} open`;
    case "task_update": {
      const payload = event.payload as {
        description?: unknown;
        status?: unknown;
        error?: unknown;
      };
      const status = typeof payload.status === "string" ? payload.status : "unknown";
      const description =
        typeof payload.description === "string" ? truncateOneLine(payload.description) : "task";
      const error = typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : "";

      return `${status}: ${description}${error}`;
    }
    case "plan_exit": {
      const payload = event.payload as { accepted?: unknown; planPath?: unknown };

      return `${payload.accepted === true ? "accepted" : "continued"}: ${String(payload.planPath ?? "plan")}`;
    }
    case "magi_decision_trail":
      return "MAGI decision trail";
  }
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

type ToolDisplaySummary = {
  content: string;
  target?: string;
  countLabel?: string;
  summary?: string;
  preview?: string;
};

function formatToolResultSummary(result: ToolResult, input: unknown): ToolDisplaySummary {
  if (!result.ok) {
    return {
      content: "failed",
      summary: result.error ? truncateOneLine(result.error) : undefined,
    };
  }

  const output = result.output.trim();
  switch (result.name) {
    case "read": {
      const path = readInputString(input, "path") ?? "file";
      const lineCount = output.length === 0 ? 0 : output.split("\n").length;
      return {
        content: "file read complete",
        target: path,
        countLabel: `${lineCount} lines, ${result.output.length} chars`,
        preview: formatOutputPreview(result.output),
      };
    }
    case "glob": {
      const pattern = readInputString(input, "pattern") ?? "pattern";
      const matches = output.length === 0 ? 0 : output.split("\n").length;
      return {
        content: "glob complete",
        target: pattern,
        countLabel: `${matches} matches`,
        preview: formatOutputPreview(result.output),
      };
    }
    case "grep": {
      const pattern = readInputString(input, "pattern") ?? "pattern";
      const include = readInputString(input, "include");
      const matches = output.length === 0 ? 0 : output.split("\n").length;
      return {
        content: "search complete",
        target: include ? `${pattern} in ${include}` : pattern,
        countLabel: `${matches} matches`,
        preview: formatOutputPreview(result.output),
      };
    }
    case "bash": {
      const command = readInputString(input, "command") ?? "command";
      return {
        content: "command complete",
        target: command,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "webfetch": {
      const url = readInputString(input, "url") ?? "url";
      return {
        content: "fetched URL",
        target: url,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "websearch": {
      const query = readInputString(input, "query") ?? "query";
      return {
        content: "web search complete",
        target: query,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "lsp_symbols":
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover":
    case "lsp_call_hierarchy": {
      const filePath = readInputString(input, "filePath") ?? "file";
      return {
        content: "LSP query complete",
        target: filePath,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "apply_patch":
      return {
        content: "workspace updated",
        target: formatPatchTargets(input) ?? "patch",
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    case "edit":
    case "write": {
      const filePath = readInputString(input, "filePath") ?? "file";
      return {
        content: "workspace updated",
        target: filePath,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    default:
      return { content: "tool complete", summary: formatOutputSummary(result.output) };
  }
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

function countOpenTodos(todos: TodoItem[]): number {
  return todos.filter((todo) => todo.status !== "completed").length;
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

function formatOutputSummary(output: string): string {
  const trimmed = output.trim();

  if (trimmed.length === 0) {
    return "empty output";
  }

  const lines = trimmed.split("\n");
  return lines.length === 1
    ? truncateOneLine(trimmed)
    : `${lines.length} lines: ${truncateOneLine(trimmed)}`;
}

function formatOutputPreview(output: string): string | undefined {
  const lines = output
    .trim()
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return undefined;
  }

  const previewLines = lines.slice(0, 4);
  const suffix =
    lines.length > previewLines.length
      ? `\n  ... ${lines.length - previewLines.length} more lines`
      : "";
  return (
    [`preview:`, ...previewLines.map((line) => `  ${truncateOneLine(line)}`)].join("\n") + suffix
  );
}

function formatPatchTargets(input: unknown): string | undefined {
  const patch = readInputString(input, "patchText") ?? readInputString(input, "patch");
  if (!patch) {
    return undefined;
  }

  const paths = new Set<string>();
  for (const line of patch.split("\n")) {
    const match = /^(?:\+\+\+ b\/|--- a\/|\*\*\* (?:Add|Update|Delete) File: )(.+)$/.exec(line);
    if (match?.[1] && match[1] !== "/dev/null") {
      paths.add(match[1].trim());
    }
  }

  if (paths.size === 0) {
    return undefined;
  }

  const pathList = [...paths];
  return pathList.length <= 3
    ? pathList.join(", ")
    : `${pathList.slice(0, 3).join(", ")} (+${pathList.length - 3} more)`;
}

function readInputString(input: unknown, field: string): string | undefined {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return undefined;
  }

  const value = (input as Record<string, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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

function truncateOneLine(value: string): string {
  const oneLine = value.replaceAll("\n", " ");

  return oneLine.length > 160 ? `${oneLine.slice(0, 160)}...` : oneLine;
}

function openExternalUrl(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];

  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
