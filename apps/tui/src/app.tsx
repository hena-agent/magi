import { loadConfig } from "@magi/config";
import { runVerificationCommands } from "@magi/harness";
import {
  buildAgentSessionContext,
  buildRevisionContext,
  buildSharedContextHistory,
  createPrimaryModelAdapter,
  createSessionStore,
  createTask,
  createToolCall,
  extractFirstDiffBlock,
  getLatestProposedPatch,
  getToolPermission,
  runAgentTurn,
  runTool,
  selectReviewLenses,
  summarizeWorkspace,
  type ExecutableAgentAction,
  type Session,
  type SessionEvent,
  type SessionEventType,
  type SessionStore,
  type ToolCall,
  type ToolName,
  type ToolResult,
} from "@magi/core";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";

type DisplayMessage = {
  id: string;
  content: string;
};

type PendingPermission = {
  call: ToolCall;
  description: string;
  resolve: (allow: boolean) => void;
};

type DraftSessionEvent = Omit<SessionEvent, "sessionId">;

type AppendSessionEventInput = {
  type: SessionEventType;
  payload: unknown;
};

const shellCommands = [
  "bash",
  "apply_patch",
  "apply_last_patch",
  "verify",
  "revise",
  "magi_preview",
  "summary",
  "sessions",
  "resume",
  "new",
  "rename",
  "history",
  "help",
];

const defaultSessionTitle = "MAGI TUI session";

type InitialSessionState = {
  session?: Session;
  resumed: boolean;
};

export function App() {
  const { exit } = useApp();
  const config = loadConfig();
  const task = createTask("Bootstrap MAGI TUI");
  const canReadInput = Boolean(process.stdin.isTTY && process.stdin.setRawMode);
  const [store] = useState(() => createSessionStore({ workspaceRoot: config.workspaceRoot }));
  const [initialSession] = useState<InitialSessionState>(() => createInitialSession(store, config));
  const draftEventsRef = useRef<DraftSessionEvent[]>([]);
  const [session, setSession] = useState<Session | undefined>(initialSession.session);
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
  const [busyDepth, setBusyDepth] = useState(0);
  const isBusy = busyDepth > 0;

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

    const userEvent = appendSessionEvent({
      type: "user_message",
      payload: { content },
    });
    addMessage(`User: ${content}`, `${userEvent.id}-user`);

    await runSingleEngineAgentTurn(content);
  }

  async function handleCommand(content: string): Promise<void> {
    const [command = "", ...args] = content.slice(1).split(" ");

    if (command === "help") {
      addMessage(
        `Commands: ${shellCommands.map((name) => `/${name}`).join(", ")}, /read, /glob, /grep`,
      );
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

  async function runSingleEngineAgentTurn(content: string): Promise<void> {
    beginBusy();

    try {
      const adapter = createPrimaryModelAdapter(config);
      const sessionContext = buildAgentSessionContext({
        events: getCurrentSessionEvents().slice(0, -1),
      });
      const result = await runAgentTurn({
        engine: adapter,
        userMessage: content,
        sessionContext,
        maxIterations: config.agent.maxIterations,
        async executeAction(action) {
          return await executeAgentAction(action);
        },
      });
      const event = appendSessionEvent({
        type: "assistant_message",
        payload: { content: result.finalText, agentTurn: true, status: result.status },
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
    }
  }

  async function executeAgentAction(action: ExecutableAgentAction): Promise<string> {
    switch (action.type) {
      case "read":
        return await executeToolAction(createToolCall("read", { path: action.path }));
      case "glob":
        return await executeToolAction(createToolCall("glob", { pattern: action.pattern }));
      case "grep":
        return await executeToolAction(
          createToolCall("grep", {
            pattern: action.pattern,
            ...(action.include === undefined ? {} : { include: action.include }),
          }),
        );
      case "verify":
        return await runVerification(action.command ?? "");
      case "propose_patch": {
        const event = appendSessionEvent({
          type: "proposed_patch",
          payload: { source: "agent_turn", patch: action.patch, summary: action.summary },
        });
        addMessage(
          `Proposed patch saved as event #${event.sequence}. Requesting write approval...`,
        );
        return await executeToolAction(createToolCall("apply_patch", { patch: action.patch }));
      }
    }
  }

  async function executeToolAction(call: ToolCall): Promise<string> {
    const result = await runToolWithPermission(call);

    if (!result) {
      return `${call.name} did not run.`;
    }

    return result.ok ? result.output || "ok" : `failed: ${result.error}`;
  }

  async function runToolWithPermission(call: ToolCall): Promise<ToolResult | undefined> {
    const permission = getToolPermission(call.name);
    const policy = config.permissions[permission];

    if (policy === "deny") {
      appendSessionEvent({
        type: "permission_decision",
        payload: { toolCallId: call.id, action: permission, decision: "deny" },
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
        addMessage(`Denied: ${call.name}`);
        return;
      }
    }

    return await executeToolCall(call);
  }

  function resolvePermission(allow: boolean): void {
    if (!pendingPermission) {
      return;
    }

    pendingPermission.resolve(allow);
  }

  async function executeToolCall(call: ToolCall): Promise<ToolResult> {
    beginBusy();
    appendSessionEvent({ type: "tool_call", payload: call });

    try {
      const result = await runTool(call, { workspaceRoot: config.workspaceRoot });
      appendSessionEvent({ type: "tool_result", payload: result });
      addMessage(
        `${call.name}: ${result.ok ? truncate(result.output || "ok") : `failed: ${result.error}`}`,
      );
      return result;
    } finally {
      endBusy();
    }
  }

  async function runVerification(command: string): Promise<string> {
    beginBusy();

    try {
      const results = await runVerificationCommands({
        commands: command.length > 0 ? [command] : config.verificationCommands,
        cwd: config.workspaceRoot,
      });

      for (const result of results) {
        appendSessionEvent({ type: "verification_result", payload: result });
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

    setSession(selectedSession);
    setMessages([
      {
        id: crypto.randomUUID(),
        content: `Resumed session: ${selectedSession.id}${selectedSession.title ? ` (${selectedSession.title})` : ""}`,
      },
      ...sessionEventsToDisplayMessages(store.listEvents(selectedSession.id), 30),
    ]);
  }

  function createNewSession(_title: string): void {
    if (!canSwitchSessions()) {
      return;
    }

    draftEventsRef.current = [];
    setSession(undefined);
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
    <Box flexDirection="column">
      <Text color="cyan" bold>
        MAGI
      </Text>
      <Text>Mode: {task.mode}</Text>
      <Text>Risk: {task.riskLevel}</Text>
      <Text>Workspace: {config.workspaceRoot}</Text>
      <Text>Session: {session?.id ?? "draft"}</Text>
      {isBusy ? <Text color="yellow">Running...</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {messages.map((message) => (
          <Text key={message.id}>{message.content}</Text>
        ))}
      </Box>
      {pendingPermission ? (
        <Text color="yellow">{`Permission: ${pendingPermission.description}`}</Text>
      ) : null}
      <Text>{pendingPermission ? "Allow? [y/N]" : `> ${prompt}`}</Text>
      <Text dimColor>
        {canReadInput
          ? "Type a prompt, /help for commands, or q on an empty prompt to quit."
          : "Watching for changes. Stop the dev process to quit."}
      </Text>
    </Box>
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
    case "apply_patch":
      return createToolCall(command, { patchFile: rawArgs.trim() });
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
      case "summary": {
        const payload = event.payload as { text?: unknown };

        return typeof payload.text === "string"
          ? [{ id: event.id, content: truncate(payload.text) }]
          : [];
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
      const payload = event.payload as { name?: unknown; ok?: unknown; error?: unknown };
      const name = typeof payload.name === "string" ? payload.name : "tool";

      return `${name}: ${payload.ok === true ? "ok" : "failed"}${typeof payload.error === "string" ? `: ${truncateOneLine(payload.error)}` : ""}`;
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
    case "magi_decision_trail":
      return "MAGI decision trail";
  }
}

function isToolName(value: string): value is ToolName {
  return (
    value === "read" ||
    value === "glob" ||
    value === "grep" ||
    value === "bash" ||
    value === "apply_patch"
  );
}

function truncate(value: string): string {
  return value.length > 2000 ? `${value.slice(0, 2000)}\n... truncated` : value;
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
