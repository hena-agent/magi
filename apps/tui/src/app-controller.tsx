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
  getAgentCommand,
  getAuth,
  getAgent,
  getDefaultModelSelection,
  getDefaultAgent,
  getEffectiveModelProviderSummaries,
  getLatestProposedPatch,
  getLatestModelSelection,
  getToolPermission,
  listAgentCommands,
  listAgents,
  listEffectiveModelProviders,
  loadModelsDevCatalog,
  loginOpenAICodexBrowser,
  loginOpenAICodexHeadless,
  MAGI_BUILD_SWITCH_REMINDER,
  MAGI_PLAN_MODE_PROMPT,
  mergeAgentPermission,
  planSessionMaintenance,
  refreshOpenAICodexAuth,
  removeAuth,
  runAgentTurn,
  runTool,
  selectMagiEngineCandidates,
  selectReviewLenses,
  summarizeWorkspace,
  type AgentCommandInfo,
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

export type DisplayMessage = {
  id: string;
  content: string;
  detail?: string;
  kind?: "user" | "assistant" | "tool" | "status" | "error" | "system";
  title?: string;
  tone?: "normal" | "muted" | "success" | "warning" | "danger";
  expandable?: boolean;
  collapsed?: boolean;
  metadata?: {
    toolName?: string;
    durationMs?: number;
    target?: string;
    countLabel?: string;
    summary?: string;
    preview?: string;
  };
};

export type ActiveRunState = {
  agentId: string;
  command: string;
  phase: string;
  step?: number;
  maxSteps?: number;
  detail?: string;
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

function agentCommandToSlashCommand(command: AgentCommandInfo): SlashCommandInfo {
  return {
    name: command.id,
    usage: command.usage,
    description: command.description,
    category: "Current Agent",
  };
}

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

function getSlashCommandSuggestions(
  input: string,
  commands: SlashCommandInfo[],
): SlashCommandInfo[] {
  if (!input.startsWith("/")) {
    return [];
  }

  const rawQuery = input.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (rawQuery.length === 0) {
    return commands.slice(0, 8);
  }

  return commands
    .filter((command) => {
      const names = [command.name, ...(command.aliases ?? [])];
      return names.some((name) => name.toLowerCase().startsWith(rawQuery));
    })
    .slice(0, 8);
}

function formatSlashCommandHelp(commands: SlashCommandInfo[]): string {
  const categories = [
    "Current Agent",
    "Session",
    "Model/Auth",
    "Agent",
    "Workflow",
    "MAGI",
    "Tools",
  ];
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
  runState?: Pick<ActiveRunState, "command" | "phase">;
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
  const [messages, setMessages] = useState<DisplayMessage[]>(() => [
    {
      id: "session-start",
      content:
        initialSession.session === undefined
          ? "Draft session: a session will be saved after the first successful prompt."
          : `${initialSession.resumed ? "Resumed latest session" : "Started new session"}: ${initialSession.session.id}${initialSession.session.title ? ` (${initialSession.session.title})` : ""}`,
    },
    ...(initialSession.session === undefined
      ? []
      : sessionEventsToDisplayMessages(store.listEvents(initialSession.session.id), 30)),
  ]);
  const [transcriptScrollOffset, setTranscriptScrollOffset] = useState(0);
  const [selectedMessageId, setSelectedMessageId] = useState<string | undefined>();
  const [expandedMessageIds, setExpandedMessageIds] = useState<Set<string>>(() => new Set());
  const [activeStatus, setActiveStatus] = useState("Ready");
  const [activeRunState, setActiveRunState] = useState<ActiveRunState>();
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
  const activeAgentSlashCommands = listAgentCommands(activeAgent.id).map(
    agentCommandToSlashCommand,
  );
  const availableSlashCommands = [...activeAgentSlashCommands, ...visibleSlashCommands];
  const slashCommandSuggestions =
    pendingPermission || pendingQuestion || pendingSelector
      ? []
      : getSlashCommandSuggestions(prompt, availableSlashCommands);

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

  function addAgentModeReminders(content: string, agent: AgentInfo): string {
    if (agent.id !== "plan") {
      return content;
    }

    const planPath = getPlanFilePath();
    const planInfo = `No plan file exists yet. You should create your plan at ${planPath} using the write tool.`;

    return [content, "", MAGI_PLAN_MODE_PROMPT.replace("$" + "{planInfo}", planInfo)].join("\n");
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
    if (messages.length === 0) return;
    const currentIndex = selectedMessageId
      ? messages.findIndex((message) => message.id === selectedMessageId)
      : messages.length - 1;
    const nextIndex = Math.max(0, Math.min(messages.length - 1, currentIndex + direction));
    const nextMessageId = messages[nextIndex]?.id;
    setSelectedMessageId(nextMessageId);
    if (nextMessageId) {
      keepTranscriptMessageVisible(nextMessageId, expandedMessageIds);
    }
  }

  function toggleSelectedMessageExpansion(): void {
    if (!selectedMessageId) return;
    const selected = messages.find((message) => message.id === selectedMessageId);
    if (!selected?.expandable) return;
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
      addMessage(formatSlashCommandHelp(availableSlashCommands));
      return;
    }

    if (command === "mode") {
      showModeStatus();
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

    const agentCommand = getAgentCommand(activeAgent.id, command);
    if (agentCommand) {
      await executeAgentScopedCommand(agentCommand, args.join(" ").trim());
      return;
    }

    addMessage(`Unknown command: /${command}. Type /help for available commands.`);
  }

  async function executeAgentScopedCommand(
    command: AgentCommandInfo,
    input: string,
  ): Promise<void> {
    switch (command.id) {
      case "plan":
        await switchAgentAndMaybeRun("plan", input);
        return;
      case "build":
        await switchAgentAndMaybeRun("build", input);
        return;
      case "done":
        await showAgentDoneCheckpoint();
        return;
    }
  }

  async function showAgentDoneCheckpoint(): Promise<void> {
    if (activeAgent.id === "plan") {
      addMessage(
        [
          "Plan checkpoint:",
          `- plan file: ${getPlanFilePath()}`,
          "- suggested next: ask the plan agent to validate the plan, then switch to /build when ready.",
        ].join("\n"),
      );
      return;
    }

    if (!session) {
      addMessage("Build checkpoint: no saved session yet. Run a normal prompt first.");
      return;
    }

    await runSummary();
  }

  async function submitAgentPrompt(
    content: string,
    agent: AgentInfo,
    providerId: string | undefined,
    runState: Pick<ActiveRunState, "command" | "phase"> = {
      command: "prompt",
      phase: "running",
    },
  ): Promise<void> {
    const userEvent = appendSessionEvent({
      type: "user_message",
      payload: { content, agentId: agent.id, providerId },
    });
    addMessage(`User: ${content}`, `${userEvent.id}-user`);

    await runSingleEngineAgentTurn(content, agent, providerId, runState);
  }

  async function runSingleEngineAgentTurn(
    content: string,
    agent: AgentInfo,
    providerId: string | undefined,
    runState: Pick<ActiveRunState, "command" | "phase"> = {
      command: "prompt",
      phase: "running",
    },
  ): Promise<void> {
    beginBusy();
    startActiveRun(agent, runState.command, runState.phase);
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
      const agentContent = addAgentModeReminders(effectiveContent, agent);
      const sessionContext = buildAgentSessionContext({
        events: getCurrentSessionEvents().slice(0, -1),
      });
      const systemContext = buildAgentSystemContext({ workspaceRoot: config.workspaceRoot });
      const result = await runAgentTurn({
        engine: adapter,
        agent,
        userMessage: agentContent,
        systemContext,
        sessionContext,
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
      addMessage(`Assistant: ${truncate(result.finalText)}`, event.id);
    } catch (error) {
      if (!session) {
        draftEventsRef.current = [];
      }
      addMessage(`Agent error: ${formatError(error)}`);
    } finally {
      clearActiveRun();
      setActiveStatus("Ready");
      endBusy();
      void drainQueuedPrompts();
    }
  }

  async function executeAgentAction(
    action: ExecutableAgentAction,
    agent: AgentInfo,
    providerId: string | undefined = activeProviderId,
  ): Promise<string> {
    switch (action.type) {
      case "read":
        return await executeToolAction(createToolCall("read", { path: action.path }), agent);
      case "glob":
        return await executeToolAction(createToolCall("glob", { pattern: action.pattern }), agent);
      case "grep":
        return await executeToolAction(
          createToolCall("grep", {
            pattern: action.pattern,
            ...(action.include === undefined ? {} : { include: action.include }),
          }),
          agent,
        );
      case "edit":
        if (agent.id === "plan" && isPlanFilePath(action.filePath)) {
          return toolResultToObservation(
            await executeToolCall(
              createToolCall("edit", {
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
          createToolCall("edit", {
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
              createToolCall("write", { filePath: action.filePath, content: action.content }),
              agent,
            ),
          );
        }

        return await executeToolAction(
          createToolCall("write", { filePath: action.filePath, content: action.content }),
          agent,
        );
      case "apply_patch":
        return await executeToolAction(
          createToolCall("apply_patch", { patchText: action.patchText }),
          agent,
        );
      case "webfetch":
        return await executeToolAction(
          createToolCall("webfetch", {
            url: action.url,
            ...(action.format === undefined ? {} : { format: action.format }),
            ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
          }),
          agent,
        );
      case "websearch":
        return await executeToolAction(
          createToolCall("websearch", {
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
        return await executeToolAction(createToolCall("todowrite", { todos: action.todos }), agent);
      case "question":
        return await executeToolAction(
          createToolCall("question", { questions: action.questions }),
          agent,
        );
      case "skill":
        return await executeToolAction(createToolCall("skill", { name: action.name }), agent);
      case "lsp_symbols":
        return await executeToolAction(
          createToolCall("lsp_symbols", { filePath: action.filePath }),
          agent,
        );
      case "lsp_definition":
      case "lsp_references":
      case "lsp_hover":
      case "lsp_call_hierarchy":
        return await executeToolAction(
          createToolCall(action.type, {
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
          createToolCall("apply_patch", { patch: action.patch }),
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
    switch (action.type) {
      case "read":
        return createToolCall("read", { path: action.path });
      case "glob":
        return createToolCall("glob", { pattern: action.pattern });
      case "grep":
        return createToolCall("grep", {
          pattern: action.pattern,
          ...(action.include === undefined ? {} : { include: action.include }),
        });
      case "edit":
        return createToolCall("edit", {
          filePath: action.filePath,
          oldString: action.oldString,
          newString: action.newString,
          ...(action.replaceAll === undefined ? {} : { replaceAll: action.replaceAll }),
        });
      case "write":
        return createToolCall("write", { filePath: action.filePath, content: action.content });
      case "apply_patch":
        return createToolCall("apply_patch", { patchText: action.patchText });
      case "webfetch":
        return createToolCall("webfetch", {
          url: action.url,
          ...(action.format === undefined ? {} : { format: action.format }),
          ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
        });
      case "websearch":
        return createToolCall("websearch", {
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
        return createToolCall("todowrite", { todos: action.todos });
      case "skill":
        return createToolCall("skill", { name: action.name });
      case "lsp_symbols":
        return createToolCall("lsp_symbols", { filePath: action.filePath });
      case "lsp_definition":
      case "lsp_references":
      case "lsp_hover":
      case "lsp_call_hierarchy":
        return createToolCall(action.type, {
          filePath: action.filePath,
          line: action.line,
          character: action.character,
          ...(action.type === "lsp_call_hierarchy" && action.direction !== undefined
            ? { direction: action.direction }
            : {}),
        });
      case "verify":
        return createToolCall("bash", { command: action.command ?? "" });
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
    const toolSummary = formatToolCallSummary(call);
    setActiveStatus(`Running ${toolSummary}`);
    updateActiveRunState({ phase: "tool", detail: toolSummary });
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
      addDisplayMessage(formatToolResultDisplayMessage(result, call.input, { durationMs }));
      return result;
    } finally {
      setActiveStatus("Ready");
      endBusy();
    }
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
    updateActiveRunState({ phase: "subprocess verify", detail: command || "configured commands" });

    try {
      setActiveStatus(`Running ${command || "configured verification"}`);
      updateActiveRunState({ detail: command || "configured commands" });
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
      setActiveStatus("Ready");
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
        addMessage("No verification failures found. Ask the active agent to verify first.");
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
      {
        id: crypto.randomUUID(),
        content: `Resumed session: ${selectedSession.id}${selectedSession.title ? ` (${selectedSession.title})` : ""}`,
      },
      ...sessionEventsToDisplayMessages(selectedEvents, 30),
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
      {
        id: crypto.randomUUID(),
        content: "Started a new draft session. It will be saved after the first successful prompt.",
      },
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

    await submitAgentPrompt(content, agent, activeProviderId, {
      command: `/${agentId}`,
      phase: agentId === "plan" ? "planning" : "building",
    });
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
      addMessage(`User: ${nextPrompt.content}`, `${userEvent.id}-user`);
      await runSingleEngineAgentTurn(
        nextPrompt.content,
        nextPrompt.agent,
        nextPrompt.providerId,
        nextPrompt.runState,
      );
    }
  }

  function appendAgentTurnEvent(event: AgentTurnEvent, agent: AgentInfo): void {
    appendSessionEvent({
      type: event.type,
      payload: { ...event.payload, agentId: agent.id },
    });
    updateActiveStatusFromAgentEvent(event);
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
        setActiveStatus("Thinking...");
        updateActiveRunState({ phase: "thinking", detail: undefined });
        return;
      case "provider_error":
        setActiveStatus("Provider error");
        updateActiveRunState({ phase: "provider_error" });
        return;
      case "agent_step_ended": {
        const payload = event.payload as { status?: unknown };
        setActiveStatus(`Step ${String(payload.status ?? "ended")}`);
        updateActiveRunState({ phase: String(payload.status ?? "ended"), detail: undefined });
        return;
      }
      case "agent_step_started": {
        const payload = event.payload as {
          iteration?: unknown;
          maxIterations?: unknown;
          reason?: unknown;
        };
        setActiveStatus("Preparing next step...");
        updateActiveRunState({
          phase: String(payload.reason ?? "thinking"),
          step: typeof payload.iteration === "number" ? payload.iteration : undefined,
          maxSteps: typeof payload.maxIterations === "number" ? payload.maxIterations : undefined,
          detail: undefined,
        });
        return;
      }
    }
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
    addDisplayMessage({ id, content });
  }

  function addDisplayMessage(message: DisplayMessage): void {
    setMessages((currentMessages) => [...currentMessages, message]);
    setSelectedMessageId(message.id);
    setTranscriptScrollOffset((offset) =>
      offset === 0
        ? 0
        : offset + getDisplayMessageLineCount(message, expandedMessageIds.has(message.id)),
    );
  }

  function startActiveRun(agent: AgentInfo, command: string, phase: string): void {
    setActiveRunState({ agentId: agent.id, command, phase });
  }

  function updateActiveRunState(update: Partial<ActiveRunState>): void {
    setActiveRunState((currentState) =>
      currentState ? { ...currentState, ...update } : currentState,
    );
  }

  function clearActiveRun(): void {
    setActiveRunState(undefined);
  }

  function beginBusy(): void {
    setBusyDepth((currentDepth) => currentDepth + 1);
  }

  function endBusy(): void {
    setBusyDepth((currentDepth) => Math.max(0, currentDepth - 1));
  }

  return (
    <AppView
      activeRunState={activeRunState}
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

function sessionEventsToDisplayMessages(events: SessionEvent[], limit: number): DisplayMessage[] {
  const displayableMessages = events.flatMap((event): DisplayMessage[] => {
    switch (event.type) {
      case "user_message": {
        const payload = event.payload as { content?: unknown };

        return typeof payload.content === "string"
          ? [{ id: `${event.id}-user`, content: `User: ${truncate(payload.content)}` }]
          : [];
      }
      case "assistant_message": {
        const payload = event.payload as { content?: unknown };

        return typeof payload.content === "string"
          ? [{ id: event.id, content: `Assistant: ${truncate(payload.content)}` }]
          : [];
      }
      case "verification_result": {
        const payload = event.payload as { command?: unknown; status?: unknown };

        return typeof payload.command === "string" && typeof payload.status === "string"
          ? [{ id: event.id, content: `verify: ${payload.command}: ${payload.status}` }]
          : [];
      }
      case "tool_settlement": {
        const payload = event.payload as { name?: unknown; status?: unknown };
        const name = typeof payload.name === "string" ? payload.name : "tool";
        const status = typeof payload.status === "string" ? payload.status : "unknown";

        return [{ id: event.id, content: `${name}: ${status}` }];
      }
      case "summary": {
        const payload = event.payload as { text?: unknown };

        return typeof payload.text === "string"
          ? [{ id: event.id, content: truncate(payload.text) }]
          : [];
      }
      case "model_switch": {
        const payload = event.payload as { providerId?: unknown; model?: unknown };

        return typeof payload.providerId === "string" && typeof payload.model === "string"
          ? [{ id: event.id, content: `model: ${payload.providerId} (${payload.model})` }]
          : [];
      }
      case "todo_update": {
        const todos = readTodosFromPayload(event.payload);

        return [{ id: event.id, content: `todos: ${countOpenTodos(todos)} open` }];
      }
      case "task_update": {
        const payload = event.payload as {
          description?: unknown;
          status?: unknown;
          taskId?: unknown;
        };
        const status = typeof payload.status === "string" ? payload.status : "unknown";
        const description =
          typeof payload.description === "string" ? truncateOneLine(payload.description) : "task";
        const taskId = typeof payload.taskId === "string" ? ` (${payload.taskId})` : "";

        return [{ id: event.id, content: `task: ${status}: ${description}${taskId}` }];
      }
      case "plan_exit": {
        const payload = event.payload as { accepted?: unknown; planPath?: unknown };

        return [
          {
            id: event.id,
            content: `plan_exit: ${payload.accepted === true ? "accepted" : "continued"} (${String(payload.planPath ?? "plan")})`,
          },
        ];
      }
      default:
        return [];
    }
  });

  return displayableMessages.slice(-limit);
}

function getTranscriptMaxScrollOffset(
  messages: DisplayMessage[],
  expandedIds: Set<string>,
): number {
  return Math.max(0, getTranscriptLineCount(messages, expandedIds) - transcriptLineLimit);
}

function getTranscriptLineCount(messages: DisplayMessage[], expandedIds: Set<string>): number {
  return messages.reduce(
    (count, message) => count + getDisplayMessageLineCount(message, expandedIds.has(message.id)),
    0,
  );
}

function getTranscriptMessageLineRange(
  messages: DisplayMessage[],
  expandedIds: Set<string>,
  messageId: string,
): { start: number; end: number } | undefined {
  let start = 0;

  for (const message of messages) {
    const lineCount = getDisplayMessageLineCount(message, expandedIds.has(message.id));
    const end = start + lineCount;
    if (message.id === messageId) {
      return { start, end };
    }

    start = end;
  }

  return undefined;
}

function getDisplayMessageLineCount(message: DisplayMessage, expanded = false): number {
  const bodyLines = splitDisplayLines(message.content).length;
  const metadataLines = [
    message.metadata?.target,
    message.metadata?.durationMs === undefined ? undefined : String(message.metadata.durationMs),
    message.metadata?.countLabel,
    message.metadata?.summary,
    message.metadata?.preview,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .reduce((count, value) => count + splitDisplayLines(value).length, 0);
  const detailLines =
    message.expandable && expanded && message.detail ? splitDisplayLines(message.detail).length : 0;
  const collapsedHintLines = message.expandable && !expanded ? 1 : 0;

  return 2 + bodyLines + metadataLines + detailLines + collapsedHintLines;
}

function splitDisplayLines(value: string): string[] {
  const lines = value.split("\n");
  return lines.length === 0 ? [""] : lines;
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

function formatToolResultDisplayMessage(
  result: ToolResult,
  input: unknown,
  metadata: { durationMs?: number } = {},
): DisplayMessage {
  const summary = formatToolResultSummary(result, input);
  const detail = result.ok ? result.output.trim() : (result.error ?? result.output).trim();
  const expandable = detail.length > 0;

  return {
    id: result.id,
    kind: result.ok ? "tool" : "error",
    title: `${result.ok ? "✓" : "✕"} ${result.name}`,
    content: summary.content,
    ...(expandable ? { detail, expandable: true, collapsed: true } : {}),
    tone: result.ok ? "success" : "danger",
    metadata: {
      toolName: result.name,
      ...(metadata.durationMs !== undefined ? { durationMs: metadata.durationMs } : {}),
      ...(summary.target ? { target: summary.target } : {}),
      ...(summary.countLabel ? { countLabel: summary.countLabel } : {}),
      ...(summary.summary ? { summary: summary.summary } : {}),
      ...(summary.preview ? { preview: summary.preview } : {}),
    },
  };
}

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
