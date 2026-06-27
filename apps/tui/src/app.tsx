import { loadConfig } from "@magi/config";
import { runVerificationCommands } from "@magi/harness";
import {
  buildRevisionContext,
  createPrimaryModelAdapter,
  createSessionStore,
  createTask,
  createToolCall,
  extractFirstDiffBlock,
  getLatestProposedPatch,
  getToolPermission,
  runTool,
  summarizeWorkspace,
  type ToolCall,
  type ToolName,
} from "@magi/core";
import { Box, Text, useApp, useInput } from "ink";
import { useEffect, useState } from "react";

type DisplayMessage = {
  id: string;
  content: string;
};

type PendingPermission = {
  call: ToolCall;
  description: string;
};

const shellCommands = [
  "bash",
  "apply_patch",
  "apply_last_patch",
  "verify",
  "revise",
  "summary",
  "help",
];

export function App() {
  const { exit } = useApp();
  const config = loadConfig();
  const task = createTask("Bootstrap MAGI TUI");
  const canReadInput = Boolean(process.stdin.isTTY && process.stdin.setRawMode);
  const [{ session, store }] = useState(() => {
    const sessionStore = createSessionStore({ workspaceRoot: config.workspaceRoot });

    return {
      session: sessionStore.createSession({ title: "MAGI TUI session" }),
      store: sessionStore,
    };
  });
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [pendingPermission, setPendingPermission] = useState<PendingPermission>();
  const [isBusy, setIsBusy] = useState(false);

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
    const userEvent = store.appendEvent({
      sessionId: session.id,
      type: "user_message",
      payload: { content },
    });
    addMessage(`User: ${content}`, `${userEvent.id}-user`);

    if (content.startsWith("/")) {
      await handleCommand(content);
      return;
    }

    await generateAssistantResponse(content);
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
      await runVerification(args.join(" ").trim());
      return;
    }

    if (command === "revise") {
      await reviseFromVerificationFailures();
      return;
    }

    if (command === "apply_last_patch") {
      await applyLastProposedPatch();
      return;
    }

    if (command === "summary") {
      await runSummary();
      return;
    }

    const call = parseToolCommand(command, args.join(" "));

    if (!call) {
      addMessage(`Unknown command: /${command}. Type /help for available commands.`);
      return;
    }

    await runToolWithPermission(call);
  }

  async function generateAssistantResponse(content: string): Promise<void> {
    setIsBusy(true);

    try {
      const adapter = createPrimaryModelAdapter(config);
      const response = await adapter.generateText({ prompt: content });
      const event = store.appendEvent({
        sessionId: session.id,
        type: "assistant_message",
        payload: { content: response.text },
      });
      saveProposedPatch(event.id, response.text);
      addMessage(`Assistant: ${truncate(response.text)}`, event.id);
    } catch (error) {
      addMessage(`Assistant error: ${formatError(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function runToolWithPermission(call: ToolCall): Promise<void> {
    const permission = getToolPermission(call.name);
    const policy = config.permissions[permission];

    if (policy === "deny") {
      store.appendEvent({
        sessionId: session.id,
        type: "permission_decision",
        payload: { toolCallId: call.id, action: permission, decision: "deny" },
      });
      addMessage(`Denied by config: ${call.name}`);
      return;
    }

    if (policy === "prompt") {
      setPendingPermission({
        call,
        description: `${call.name}: ${JSON.stringify(call.input)}`,
      });
      addMessage(`Allow ${call.name}? Press y to allow or n to deny.`);
      return;
    }

    await executeToolCall(call);
  }

  async function resolvePermission(allow: boolean): Promise<void> {
    if (!pendingPermission) {
      return;
    }

    const { call } = pendingPermission;
    const action = getToolPermission(call.name);
    store.appendEvent({
      sessionId: session.id,
      type: "permission_decision",
      payload: { toolCallId: call.id, action, decision: allow ? "allow" : "deny" },
    });
    setPendingPermission(undefined);

    if (!allow) {
      addMessage(`Denied: ${call.name}`);
      return;
    }

    await executeToolCall(call);
  }

  async function executeToolCall(call: ToolCall): Promise<void> {
    setIsBusy(true);
    store.appendEvent({ sessionId: session.id, type: "tool_call", payload: call });

    try {
      const result = await runTool(call, { workspaceRoot: config.workspaceRoot });
      store.appendEvent({ sessionId: session.id, type: "tool_result", payload: result });
      addMessage(
        `${call.name}: ${result.ok ? truncate(result.output || "ok") : `failed: ${result.error}`}`,
      );
    } finally {
      setIsBusy(false);
    }
  }

  async function runVerification(command: string): Promise<void> {
    setIsBusy(true);

    try {
      const results = await runVerificationCommands({
        commands: command.length > 0 ? [command] : config.verificationCommands,
        cwd: config.workspaceRoot,
      });

      for (const result of results) {
        store.appendEvent({ sessionId: session.id, type: "verification_result", payload: result });
        addMessage(`verify: ${result.command}: ${result.status}`);
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function runSummary(): Promise<void> {
    const summary = summarizeWorkspace({
      workspaceRoot: config.workspaceRoot,
      events: store.listEvents(session.id),
    });
    store.appendEvent({ sessionId: session.id, type: "summary", payload: summary });
    addMessage(summary.text);
  }

  async function reviseFromVerificationFailures(): Promise<void> {
    setIsBusy(true);

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
      const event = store.appendEvent({
        sessionId: session.id,
        type: "assistant_message",
        payload: { content: response.text, revision: true },
      });
      saveProposedPatch(event.id, response.text);
      addMessage(`Revision: ${truncate(response.text)}`, event.id);
    } catch (error) {
      addMessage(`Revision error: ${formatError(error)}`);
    } finally {
      setIsBusy(false);
    }
  }

  async function applyLastProposedPatch(): Promise<void> {
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

    const event = store.appendEvent({
      sessionId: session.id,
      type: "proposed_patch",
      payload: { sourceEventId, patch },
    });
    addMessage(`Proposed patch saved as event #${event.sequence}. Use /apply_last_patch to apply.`);
  }

  function addMessage(content: string, id: string = crypto.randomUUID()): void {
    setMessages((currentMessages) => [...currentMessages, { id, content }]);
  }

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        MAGI
      </Text>
      <Text>Mode: {task.mode}</Text>
      <Text>Risk: {task.riskLevel}</Text>
      <Text>Workspace: {config.workspaceRoot}</Text>
      <Text>Session: {session.id}</Text>
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

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
