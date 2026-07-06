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
  getToolPermission,
  listAgents,
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
  type ToolName,
  type ToolResult,
} from "@magi/core";
import { useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { AppView } from "./app-view.js";

export type DisplayMessage = {
  id: string;
  content: string;
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

export type TodoItem = {
  content: string;
  status: string;
  priority: string;
};

type DraftSessionEvent = Omit<SessionEvent, "sessionId">;

type AppendSessionEventInput = {
  type: SessionEventType;
  payload: unknown;
};

export type SlashCommandInfo = {
  name: string;
  usage: string;
  description: string;
  aliases?: string[];
};

const slashCommands: SlashCommandInfo[] = [
  {
    name: "model",
    usage: "/model [provider-id|status|reset]",
    description: "List or switch AI models",
  },
  {
    name: "mode",
    usage: "/mode",
    description: "Show current MAGI mode, agent, model, and session",
  },
  {
    name: "auth",
    usage: "/auth status|login|refresh|logout openai",
    description: "Manage OpenAI OAuth auth",
  },
  { name: "agent", usage: "/agent [agent-id]", description: "List or switch agents" },
  {
    name: "plan",
    usage: "/plan [prompt]",
    description: "Switch to plan agent, optionally run prompt",
  },
  {
    name: "build",
    usage: "/build [prompt]",
    description: "Switch to build agent, optionally run prompt",
  },
  { name: "queue", usage: "/queue", description: "Show queued prompts" },
  { name: "clear_queue", usage: "/clear_queue", description: "Clear queued prompts" },
  { name: "steer", usage: "/steer <message>", description: "Add steering input for the next run" },
  {
    name: "interrupt",
    usage: "/interrupt",
    description: "Stop the current run at the next safe point",
  },
  { name: "verify", usage: "/verify [command]", description: "Run verification command" },
  { name: "revise", usage: "/revise", description: "Revise from recent verification failures" },
  { name: "summary", usage: "/summary", description: "Summarize the workspace" },
  { name: "sessions", usage: "/sessions [all]", description: "List recent sessions" },
  { name: "resume", usage: "/resume <session-id|number>", description: "Resume a saved session" },
  { name: "new", usage: "/new", description: "Start a new draft session" },
  { name: "rename", usage: "/rename <title>", description: "Rename the current session" },
  { name: "history", usage: "/history [limit]", description: "Show session event history" },
  { name: "read", usage: "/read <path>", description: "Read a workspace file" },
  { name: "glob", usage: "/glob <pattern>", description: "List files matching a glob" },
  { name: "grep", usage: "/grep <pattern> [include]", description: "Search workspace files" },
  { name: "webfetch", usage: "/webfetch <url> [format]", description: "Fetch web content" },
  {
    name: "websearch",
    usage: "/websearch [provider] <query>",
    description: "Search the web with Exa, Parallel, or Brave",
  },
  { name: "todowrite", usage: "/todowrite <json>", description: "Update session todo list" },
  { name: "question", usage: "/question <json>", description: "Ask structured questions" },
  { name: "skill", usage: "/skill <name>", description: "Load a named skill" },
  { name: "lsp_symbols", usage: "/lsp_symbols <file>", description: "List document symbols" },
  {
    name: "lsp_definition",
    usage: "/lsp_definition <file> <line> <character>",
    description: "Find symbol definitions",
  },
  {
    name: "lsp_references",
    usage: "/lsp_references <file> <line> <character>",
    description: "Find symbol references",
  },
  {
    name: "lsp_hover",
    usage: "/lsp_hover <file> <line> <character>",
    description: "Show hover/type info",
  },
  { name: "bash", usage: "/bash <command>", description: "Run a shell command with permission" },
  { name: "apply_patch", usage: "/apply_patch <patch-file>", description: "Apply a patch file" },
  {
    name: "apply_last_patch",
    usage: "/apply_last_patch",
    description: "Apply latest proposed patch",
  },
  { name: "magi_preview", usage: "/magi_preview", description: "Preview MAGI consensus context" },
  {
    name: "maintain_sessions",
    usage: "/maintain_sessions",
    description: "Generate missing titles/summaries",
  },
  {
    name: "session_cleanup_candidates",
    usage: "/session_cleanup_candidates",
    description: "Show sessions that look safe to clean up",
  },
  { name: "help", usage: "/help", description: "Show command list" },
];

function getSlashCommandSuggestions(input: string): SlashCommandInfo[] {
  if (!input.startsWith("/")) {
    return [];
  }

  const rawQuery = input.slice(1).split(/\s+/, 1)[0]?.toLowerCase() ?? "";
  if (rawQuery.length === 0) {
    return slashCommands.slice(0, 8);
  }

  return slashCommands
    .filter((command) => {
      const names = [command.name, ...(command.aliases ?? [])];
      return names.some((name) => name.toLowerCase().startsWith(rawQuery));
    })
    .slice(0, 8);
}

const defaultSessionTitle = "MAGI TUI session";

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
  const [pendingPermission, setPendingPermission] = useState<PendingPermission>();
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion>();
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [todos, setTodos] = useState<TodoItem[]>(() =>
    getLatestTodos(initialSession.session ? store.listEvents(initialSession.session.id) : []),
  );
  const [busyDepth, setBusyDepth] = useState(0);
  const isBusy = busyDepth > 0;
  const slashCommandSuggestions =
    pendingPermission || pendingQuestion ? [] : getSlashCommandSuggestions(prompt);

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

      if (pendingQuestion) {
        if (key.escape) {
          resolveQuestion(undefined);
          return;
        }

        if (key.return) {
          resolveQuestion(questionAnswer.trim().length === 0 ? undefined : questionAnswer.trim());
          return;
        }

        if (key.backspace || key.delete) {
          setQuestionAnswer((currentAnswer) => currentAnswer.slice(0, -1));
          return;
        }

        if (input.length > 0 && !key.ctrl && !key.meta) {
          setQuestionAnswer((currentAnswer) => currentAnswer + input);
        }

        return;
      }

      if ((input === "q" && prompt.length === 0) || key.escape || (input === "c" && key.ctrl)) {
        exit();
        return;
      }

      if (key.return) {
        const content = prompt.trim();

        if (content.length > 0) {
          setPrompt("");
          void handleSubmittedPrompt(content);
        }

        return;
      }

      if (key.backspace || key.delete) {
        setPrompt((currentPrompt) => currentPrompt.slice(0, -1));
        return;
      }

      if (input.length > 0 && !key.ctrl && !key.meta) {
        setPrompt((currentPrompt) => currentPrompt + input);
      }
    },
    {
      isActive: canReadInput,
    },
  );

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
      addMessage(
        `Commands:\n${slashCommands.map((slashCommand) => `${slashCommand.usage} - ${slashCommand.description}`).join("\n")}`,
      );
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
      listRecentSessions(args[0] === "all" || args[0] === "--all");
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
      switchAgent(args.join(" ").trim());
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

      previewMagiContext();
      return;
    }

    const call = parseToolCommand(command, args.join(" "));

    if (!call) {
      addMessage(`Unknown command: /${command}. Type /help for available commands.`);
      return;
    }

    if (
      !requirePersistedSession(
        `Run a normal prompt first, or /resume an existing session, before running /${command}.`,
      )
    ) {
      return;
    }

    await runToolWithPermission(call);
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
    addMessage(`User: ${content}`, `${userEvent.id}-user`);

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
        return await executeToolAction(
          createToolCall(action.type, {
            filePath: action.filePath,
            line: action.line,
            character: action.character,
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
        return createToolCall(action.type, {
          filePath: action.filePath,
          line: action.line,
          character: action.character,
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

  async function executeToolCall(
    call: ToolCall,
    agent: AgentInfo = activeAgent,
  ): Promise<ToolResult> {
    beginBusy();
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
      appendSessionEvent({ type: "tool_result", payload: result });
      appendSessionEvent({
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
    } finally {
      endBusy();
    }
  }

  async function runInteractiveQuestionTool(call: ToolCall): Promise<ToolResult> {
    try {
      const questions = readQuestionPrompts(call.input);
      const answer = await new Promise<string | undefined>((resolve) => {
        setQuestionAnswer("");
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

  function previewMagiContext(): void {
    if (!session) {
      addMessage("No saved session. Run a normal prompt first, or /resume an existing session.");
      return;
    }

    const events = store.listEvents(session.id);
    const latestUserMessage = [...events].reverse().find((event) => event.type === "user_message");
    const requirementPayload = latestUserMessage?.payload as { content?: unknown } | undefined;
    const requirement =
      typeof requirementPayload?.content === "string"
        ? requirementPayload.content
        : "No user requirement yet.";
    const sharedContextHistory = buildSharedContextHistory({ requirement, sessionEvents: events });
    const summary = summarizeWorkspace({ workspaceRoot: config.workspaceRoot, events });
    const lenses = selectReviewLenses({
      riskLevel: summary.residualRisk,
      changedFiles: summary.changedFiles,
    });

    addMessage(
      [
        "MAGI preview:",
        `- shared context entries: ${sharedContextHistory.entries.length}`,
        `- selected lenses: ${lenses.map((lens) => lens.id).join(", ")}`,
        `- residual risk: ${summary.residualRisk}`,
        "- core ready: shared context, lenses, review validation, vote validation, consensus matrix, decision trails",
      ].join("\n"),
    );
  }

  function listRecentSessions(includeAll: boolean): void {
    const sessions = store.listSessions({ workspaceRoot: config.workspaceRoot, limit: 50 });
    const visibleSessions = sessions
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

    if (visibleSessions.length === 0) {
      addMessage(
        includeAll
          ? "No sessions found."
          : "No meaningful sessions found. Use /sessions all to show empty and command-only sessions.",
      );
      return;
    }

    const hiddenCount = includeAll ? 0 : sessions.length - visibleSessions.length;

    addMessage(
      [
        includeAll ? "Recent sessions:" : "Recent meaningful sessions:",
        ...visibleSessions.map(({ session: listedSession, events, displayTitle }, index) => {
          const currentMarker = listedSession.id === session?.id ? "* " : "";

          return [
            `${index + 1}. ${currentMarker}${displayTitle}`,
            `   id: ${listedSession.id}`,
            `   updated: ${listedSession.updatedAt}`,
            `   events: ${events.length}`,
          ].join("\n");
        }),
        ...(hiddenCount > 0
          ? [`Hidden ${hiddenCount} empty/command-only sessions. Use /sessions all to show them.`]
          : []),
      ].join("\n"),
    );
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

    if (subcommand.length === 0 || subcommand === "status") {
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
      await runSingleEngineAgentTurn(nextPrompt.content, nextPrompt.agent, nextPrompt.providerId);
    }
  }

  function appendAgentTurnEvent(event: AgentTurnEvent, agent: AgentInfo): void {
    appendSessionEvent({
      type: event.type,
      payload: { ...event.payload, agentId: agent.id },
    });
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
      id: crypto.randomUUID(),
      sequence: draftEventsRef.current.length + 1,
      type: input.type,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    } satisfies DraftSessionEvent;
    draftEventsRef.current = [...draftEventsRef.current, event];

    return { ...event, sessionId: "draft" };
  }

  function getCurrentSessionEvents(): SessionEvent[] {
    if (session) {
      return store.listEvents(session.id);
    }

    return draftEventsRef.current.map((event) => ({ ...event, sessionId: "draft" }));
  }

  function persistDraftSessionIfNeeded(userMessage: string, assistantMessage: string): void {
    if (session || draftEventsRef.current.length === 0) {
      return;
    }

    const title = createSessionTitle({ userMessage, assistantMessage });
    const createdSession = store.createSession({ title });

    for (const event of draftEventsRef.current) {
      store.appendEvent({ sessionId: createdSession.id, type: event.type, payload: event.payload });
    }

    draftEventsRef.current = [];
    setSession(createdSession);
    addMessage(`Saved session: ${createdSession.id} (${title})`);
  }

  function requirePersistedSession(message: string): boolean {
    if (session) {
      return true;
    }

    addMessage(message);
    return false;
  }

  function addMessage(content: string, id: string = crypto.randomUUID()): void {
    setMessages((currentMessages) => [...currentMessages, { id, content }]);
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
      isBusy={isBusy}
      messages={messages}
      mode={task.mode}
      pendingPermission={pendingPermission}
      pendingQuestion={pendingQuestion}
      planFilePath={activeAgent.id === "plan" ? getPlanFilePath() : undefined}
      prompt={prompt}
      questionAnswer={questionAnswer}
      riskLevel={task.riskLevel}
      sessionId={session?.id}
      slashCommandSuggestions={slashCommandSuggestions}
      todoOpenCount={todos.filter((todo) => todo.status !== "completed").length}
      workspaceRoot={config.workspaceRoot}
    />
  );
}

function parseToolCommand(command: string, rawArgs: string): ToolCall | undefined {
  if (!isToolName(command)) {
    return undefined;
  }

  switch (command) {
    case "read":
      return createToolCall(command, { path: rawArgs.trim() });
    case "glob":
      return createToolCall(command, { pattern: rawArgs.trim() });
    case "grep": {
      const [pattern = "", include] = rawArgs.split(" ");

      return createToolCall(command, {
        pattern,
        ...(include === undefined ? {} : { include }),
      });
    }
    case "bash":
      return createToolCall(command, { command: rawArgs });
    case "edit": {
      const firstSpaceIndex = rawArgs.search(/\s/);
      const filePath =
        firstSpaceIndex === -1 ? rawArgs.trim() : rawArgs.slice(0, firstSpaceIndex).trim();
      const args = firstSpaceIndex === -1 ? "" : rawArgs.slice(firstSpaceIndex).trimStart();
      const separatorIndex = args.indexOf("=>");

      if (separatorIndex === -1) {
        return createToolCall(command, { filePath, oldString: args, newString: "" });
      }

      return createToolCall(command, {
        filePath,
        oldString: args.slice(0, separatorIndex).trim(),
        newString: args.slice(separatorIndex + "=>".length).trim(),
      });
    }
    case "write": {
      const firstSpaceIndex = rawArgs.search(/\s/);

      if (firstSpaceIndex === -1) {
        return createToolCall(command, { filePath: rawArgs.trim(), content: "" });
      }

      return createToolCall(command, {
        filePath: rawArgs.slice(0, firstSpaceIndex).trim(),
        content: rawArgs.slice(firstSpaceIndex).trimStart(),
      });
    }
    case "apply_patch":
      return createToolCall(command, { patchFile: rawArgs.trim() });
    case "webfetch": {
      const [url = "", format] = rawArgs.split(" ");

      return createToolCall(command, {
        url,
        ...(format === undefined ? {} : { format }),
      });
    }
    case "websearch": {
      const trimmed = rawArgs.trim();
      const [first = "", ...rest] = trimmed.split(/\s+/);
      const providerId = isWebsearchProvider(first) ? first : undefined;
      const query = providerId ? rest.join(" ") : trimmed;

      return createToolCall(command, {
        query,
        ...(providerId === undefined ? {} : { providerId }),
      });
    }
    case "todowrite":
      return createToolCall(command, { todos: JSON.parse(rawArgs) as unknown });
    case "question":
      return createToolCall(command, { questions: JSON.parse(rawArgs) as unknown });
    case "skill":
      return createToolCall(command, { name: rawArgs.trim() });
    case "lsp_symbols":
      return createToolCall(command, { filePath: rawArgs.trim() });
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover": {
      const [filePath = "", line = "", character = ""] = rawArgs.split(/\s+/);

      return createToolCall(command, {
        filePath,
        line: Number(line),
        character: Number(character),
      });
    }
    case "task":
      return undefined;
    case "plan_exit":
      return undefined;
  }
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

function isToolName(value: string): value is ToolName {
  return (
    value === "read" ||
    value === "glob" ||
    value === "grep" ||
    value === "edit" ||
    value === "write" ||
    value === "bash" ||
    value === "apply_patch" ||
    value === "webfetch" ||
    value === "websearch" ||
    value === "todowrite" ||
    value === "question" ||
    value === "skill" ||
    value === "lsp_symbols" ||
    value === "lsp_definition" ||
    value === "lsp_references" ||
    value === "lsp_hover"
  );
}

function isWebsearchProvider(value: string): value is "exa" | "parallel" | "brave" {
  return value === "exa" || value === "parallel" || value === "brave";
}

function truncate(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}\n... truncated` : value;
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
    case "lsp_hover": {
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
