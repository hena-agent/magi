import type { SessionEvent } from "../session.js";
import type { PrimaryModelAdapter } from "../model.js";
import type { ToolCall } from "../tools.js";
import type { AgentAction, ExecutableAgentAction } from "./actions.js";
import { validateAgentAction } from "./actions.js";
import { parseJsonObjectFromText } from "./json.js";
import { MAGI_PLAN_REMINDER } from "./prompts.js";
import { type AgentInfo, getDefaultAgent } from "./registry.js";

export type AgentRunContinuationReason =
  | "new_user_input"
  | "all_tools_settled"
  | "queued_user_input"
  | "final_response_required";

export type AgentRunContinuation =
  | { shouldContinue: true; reason: AgentRunContinuationReason }
  | { shouldContinue: false; reason: "pending_tool_results" | "completed" | "interrupted" };

export type AgentRunStep = {
  action: AgentAction;
  observation?: string;
};

export type AgentRunEvent =
  | {
      type: "agent_step_started";
      payload: {
        runId: string;
        stepId: string;
        reason: "user_input" | "tool_result" | "queued_input" | "final_response";
      };
    }
  | { type: "assistant_started"; payload: { runId: string; stepId: string } }
  | {
      type: "agent_step_ended";
      payload: {
        runId: string;
        stepId: string;
        status: "completed" | "waiting_for_tools" | "failed" | "interrupted";
      };
    }
  | {
      type: "provider_error";
      payload: { runId: string; stepId: string; message: string; retryable: boolean };
    };

export type AgentRunResult = {
  status: "completed" | "max_iterations" | "interrupted";
  finalText: string;
  steps: AgentRunStep[];
};

export async function runEventDrivenAgent(input: {
  engine: PrimaryModelAdapter;
  agent?: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  executeAction: (action: ExecutableAgentAction) => Promise<string>;
  shouldInterrupt?: () => boolean;
  onEvent?: (event: AgentRunEvent) => void;
  maxIterations?: number;
}): Promise<AgentRunResult> {
  const agent = input.agent ?? getDefaultAgent();
  const maxIterations = input.maxIterations ?? agent.steps ?? 30;
  const runId = crypto.randomUUID();
  const steps: AgentRunStep[] = [];
  const observations: string[] = [];
  const actionCounts = new Map<string, number>();

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    if (input.shouldInterrupt?.()) {
      return { status: "interrupted", finalText: "Agent run interrupted.", steps };
    }

    const isLastStep = iteration >= maxIterations;
    const stepId = crypto.randomUUID();
    const reason = isLastStep
      ? "final_response"
      : observations.length === 0
        ? "user_input"
        : "tool_result";
    input.onEvent?.({
      type: "agent_step_started",
      payload: { runId, stepId, reason },
    });
    input.onEvent?.({ type: "assistant_started", payload: { runId, stepId } });

    let action: AgentAction;

    try {
      action = await generateAgentAction({
        engine: input.engine,
        agent,
        userMessage: input.userMessage,
        systemContext: input.systemContext,
        sessionContext: input.sessionContext,
        observations,
        iteration,
        maxIterations,
        isLastStep,
      });
    } catch (error) {
      input.onEvent?.({
        type: "provider_error",
        payload: {
          runId,
          stepId,
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
      });
      input.onEvent?.({ type: "agent_step_ended", payload: { runId, stepId, status: "failed" } });
      throw error;
    }

    if (action.type === "answer") {
      steps.push({ action });
      input.onEvent?.({
        type: "agent_step_ended",
        payload: { runId, stepId, status: "completed" },
      });
      return { status: "completed", finalText: action.content, steps };
    }

    if (action.type === "finish") {
      steps.push({ action });
      input.onEvent?.({
        type: "agent_step_ended",
        payload: { runId, stepId, status: "completed" },
      });
      return { status: "completed", finalText: action.summary, steps };
    }

    if (isLastStep) {
      const observation =
        "Maximum agent steps reached. Tools are disabled on the final step; the model must provide a final answer.";
      steps.push({ action, observation });
      observations.push(formatObservation(action, observation));
      input.onEvent?.({
        type: "agent_step_ended",
        payload: { runId, stepId, status: "completed" },
      });

      return {
        status: "max_iterations",
        finalText: await generateFinalTextOnlyResponse(input, observations, runId),
        steps,
      };
    }

    const actionKey = getActionKey(action);
    const actionCount = actionCounts.get(actionKey) ?? 0;
    actionCounts.set(actionKey, actionCount + 1);

    if (actionCount > 0) {
      const observation =
        "Repeated action skipped. Do not repeat actions that already ran; choose a different action or finish with the available observations.";
      steps.push({ action, observation });
      observations.push(formatObservation(action, observation));
      input.onEvent?.({
        type: "agent_step_ended",
        payload: { runId, stepId, status: "waiting_for_tools" },
      });
      continue;
    }

    const observation = await input.executeAction(action);
    steps.push({ action, observation });
    observations.push(formatObservation(action, observation));
    input.onEvent?.({
      type: "agent_step_ended",
      payload: { runId, stepId, status: "waiting_for_tools" },
    });
  }

  return {
    status: "max_iterations",
    finalText: await generateFinalTextOnlyResponse(input, observations, runId),
    steps,
  };
}

export function getAgentRunContinuation(input: {
  events: SessionEvent[];
  maxSteps: number;
}): AgentRunContinuation {
  const latestInterruption = [...input.events]
    .reverse()
    .find((event) => event.type === "interruption");
  const latestAssistantMessage = [...input.events]
    .reverse()
    .find((event) => event.type === "assistant_message");
  const latestUserMessage = [...input.events]
    .reverse()
    .find((event) => event.type === "user_message");
  const stepCount = input.events.filter((event) => event.type === "agent_step_started").length;

  if (
    latestInterruption &&
    (!latestAssistantMessage || latestInterruption.sequence > latestAssistantMessage.sequence)
  ) {
    return { shouldContinue: false, reason: "interrupted" };
  }

  if (hasUnsettledTools(input.events)) {
    return { shouldContinue: false, reason: "pending_tool_results" };
  }

  if (stepCount >= input.maxSteps && !latestAssistantMessage) {
    return { shouldContinue: true, reason: "final_response_required" };
  }

  if (
    latestAssistantMessage &&
    (!latestUserMessage || latestAssistantMessage.sequence > latestUserMessage.sequence)
  ) {
    return { shouldContinue: false, reason: "completed" };
  }

  const latestQueuedInput = [...input.events]
    .reverse()
    .find((event) => event.type === "queued_user_input");

  if (
    latestQueuedInput &&
    (!latestUserMessage || latestQueuedInput.sequence > latestUserMessage.sequence)
  ) {
    return { shouldContinue: true, reason: "queued_user_input" };
  }

  if (input.events.some((event) => event.type === "tool_settlement")) {
    return { shouldContinue: true, reason: "all_tools_settled" };
  }

  return { shouldContinue: true, reason: "new_user_input" };
}

const agentTurnSystemPrompt = [
  "You are MAGI running one local coding-agent turn.",
  "Respond only with JSON. Do not wrap the JSON in prose.",
  "Use the smallest useful action. Prefer read/glob/grep before proposing changes.",
  "If you have enough information, use finish or answer.",
  "Do not repeat the same action. If an action result is already available, use it or choose a different action.",
  "For models using apply_patch, provide an OpenCode-style *** Begin Patch envelope in patchText.",
  "For models using edit/write, use exact oldString/newString replacements or full file writes.",
].join("\n");

function formatAgentTurnPrompt(input: {
  agent: AgentInfo;
  userMessage: string;
  model?: string;
  sessionContext?: string;
  systemContext?: string[];
  observations: string[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
}): string {
  const writeActions =
    getEditToolMode(input.agent, input.model) === "patch"
      ? [
          {
            type: "apply_patch",
            patchText: "*** Begin Patch\n*** Update File: path\n@@\n-old\n+new\n*** End Patch",
          },
        ]
      : [
          {
            type: "edit",
            filePath: "relative/path",
            oldString: "exact text to replace",
            newString: "replacement text",
            replaceAll: false,
          },
          { type: "write", filePath: "relative/path", content: "full file content" },
        ];
  const executableActions = [
    { type: "read", path: "relative/path" },
    { type: "glob", pattern: "**/*.ts" },
    { type: "grep", pattern: "search regex", include: "optional glob" },
    ...(input.agent.permission.shell === "deny"
      ? []
      : [{ type: "verify", command: "optional focused command" }]),
    ...(input.agent.permission.write === "deny"
      ? []
      : [
          ...writeActions,
          { type: "propose_patch", summary: "what changes", patch: "unified diff" },
        ]),
  ];
  const availableActions = input.isLastStep
    ? [
        { type: "answer", content: "Final answer using observations gathered so far." },
        { type: "finish", summary: "Final concise result using observations gathered so far." },
      ]
    : [
        { type: "answer", content: "Direct answer for simple questions." },
        ...executableActions,
        { type: "finish", summary: "final concise result" },
      ];

  return [
    `User request: ${formatUserMessageWithReminders(input.agent, input.userMessage)}`,
    "",
    "Prior session context:",
    input.sessionContext === undefined || input.sessionContext.length === 0
      ? "(none)"
      : input.sessionContext,
    `Iteration: ${input.iteration}/${input.maxIterations}`,
    input.isLastStep
      ? "This is the final step. Tools/actions are disabled. You must respond with answer or finish only."
      : "Choose one available action.",
    "",
    "Available JSON actions:",
    JSON.stringify(availableActions, null, 2),
    "",
    "Observations so far:",
    input.observations.length === 0 ? "(none)" : input.observations.join("\n\n"),
  ].join("\n");
}

async function generateAgentAction(input: {
  engine: PrimaryModelAdapter;
  agent: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  observations: string[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
}): Promise<AgentAction> {
  if (!input.isLastStep && input.engine.generateStep) {
    try {
      const nativeResponse = await input.engine.generateStep({
        system: buildAgentSystemPrompt(
          input.agent,
          false,
          nativeToolSystemPrompt,
          input.systemContext,
        ),
        messages: [
          {
            role: "user",
            content: formatNativeToolPrompt(input),
          },
        ],
        tools: getNativeToolDefinitions(input.agent, input.engine.provider?.model),
        toolChoice: "auto",
      });
      const [toolCall] = nativeResponse.toolCalls;

      if (toolCall) {
        return toolCallToAgentAction(toolCall);
      }

      if (nativeResponse.text.trim().length > 0) {
        return { type: "answer", content: nativeResponse.text };
      }
    } catch {
      // Fall back to the JSON action protocol for providers without native tool-call support.
    }
  }

  const response = await input.engine.generateText({
    system: buildAgentSystemPrompt(
      input.agent,
      input.isLastStep,
      agentTurnSystemPrompt,
      input.systemContext,
    ),
    prompt: formatAgentTurnPrompt({ ...input, model: input.engine.provider?.model }),
  });

  return validateAgentAction(parseJsonObjectFromText(response.text));
}

function buildAgentSystemPrompt(
  agent: AgentInfo,
  isLastStep: boolean,
  protocolPrompt = agentTurnSystemPrompt,
  systemContext: string[] = [],
): string {
  return [
    agent.prompt,
    ...systemContext,
    protocolPrompt,
    isLastStep
      ? "This is the final text-only step. Do not request tools or actions; answer with available observations."
      : undefined,
  ]
    .filter((part) => part !== undefined && part.length > 0)
    .join("\n\n");
}

const nativeToolSystemPrompt = [
  "You are MAGI running one local coding-agent step.",
  "Use tools only when needed to inspect or modify the repository.",
  "If no tool is needed, answer concisely with the available observations.",
].join("\n");

function formatNativeToolPrompt(input: {
  agent: AgentInfo;
  userMessage: string;
  sessionContext?: string;
  observations: string[];
  iteration: number;
  maxIterations: number;
}): string {
  return [
    `User request: ${formatUserMessageWithReminders(input.agent, input.userMessage)}`,
    "",
    "Prior session context:",
    input.sessionContext === undefined || input.sessionContext.length === 0
      ? "(none)"
      : input.sessionContext,
    `Iteration: ${input.iteration}/${input.maxIterations}`,
    "Observations so far:",
    input.observations.length === 0 ? "(none)" : input.observations.join("\n\n"),
  ].join("\n");
}

const readNativeToolDefinitions = [
  {
    name: "read" as const,
    description: "Read a UTF-8 text file inside the workspace.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "glob" as const,
    description: "List workspace files matching a glob pattern.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
  {
    name: "grep" as const,
    description: "Search workspace file contents using a regular expression.",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" }, include: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
];

const editNativeToolDefinitions = [
  {
    name: "edit" as const,
    description:
      "Perform an exact string replacement in a workspace file. Prefer after reading the file. Use replaceAll only when all occurrences should change.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        replaceAll: { type: "boolean" },
      },
      required: ["filePath", "oldString", "newString"],
      additionalProperties: false,
    },
  },
  {
    name: "write" as const,
    description: "Write full content to a workspace file. Prefer edit for existing files.",
    inputSchema: {
      type: "object",
      properties: { filePath: { type: "string" }, content: { type: "string" } },
      required: ["filePath", "content"],
      additionalProperties: false,
    },
  },
];

const patchNativeToolDefinitions = [
  {
    name: "apply_patch" as const,
    description:
      "Apply an OpenCode-style patch envelope with *** Begin Patch / *** End Patch and Add/Delete/Update file sections.",
    inputSchema: {
      type: "object",
      properties: { patchText: { type: "string" } },
      required: ["patchText"],
      additionalProperties: false,
    },
  },
];

function getNativeToolDefinitions(agent: AgentInfo, model: string | undefined) {
  return [
    ...(agent.permission.read === "deny" ? [] : readNativeToolDefinitions),
    ...(agent.permission.write === "deny"
      ? []
      : getEditToolMode(agent, model) === "patch"
        ? patchNativeToolDefinitions
        : editNativeToolDefinitions),
  ];
}

function getEditToolMode(_agent: AgentInfo, model?: string): "patch" | "edit" {
  if (!model) {
    return "patch";
  }

  return model.includes("gpt-") && !model.includes("oss") && !model.includes("gpt-4")
    ? "patch"
    : "edit";
}

function toolCallToAgentAction(toolCall: ToolCall): ExecutableAgentAction {
  const input = readToolInput(toolCall.input);

  switch (toolCall.name) {
    case "read":
      return { type: "read", path: readString(input, "path") };
    case "glob":
      return { type: "glob", pattern: readString(input, "pattern") };
    case "grep": {
      const include = readOptionalString(input, "include");

      return {
        type: "grep",
        pattern: readString(input, "pattern"),
        ...(include === undefined ? {} : { include }),
      };
    }
    case "apply_patch":
      return { type: "apply_patch", patchText: readString(input, "patchText") };
    case "edit": {
      const replaceAll = readOptionalBoolean(input, "replaceAll");

      return {
        type: "edit",
        filePath: readString(input, "filePath"),
        oldString: readStringAllowEmpty(input, "oldString"),
        newString: readStringAllowEmpty(input, "newString"),
        ...(replaceAll === undefined ? {} : { replaceAll }),
      };
    }
    case "write":
      return {
        type: "write",
        filePath: readString(input, "filePath"),
        content: readStringAllowEmpty(input, "content"),
      };
    case "bash":
      return { type: "verify", command: readString(input, "command") };
  }
}

function readToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Native tool input must be an object.");
  }

  return input as Record<string, unknown>;
}

function readString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Native tool input requires string field: ${field}`);
  }

  return value;
}

function readStringAllowEmpty(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string") {
    throw new Error(`Native tool input requires string field: ${field}`);
  }

  return value;
}

function readOptionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Native tool input field must be a non-empty string: ${field}`);
  }

  return value;
}

function readOptionalBoolean(input: Record<string, unknown>, field: string): boolean | undefined {
  const value = input[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(`Native tool input field must be a boolean: ${field}`);
  }

  return value;
}

function formatObservation(action: ExecutableAgentAction, observation: string): string {
  return [`Action: ${action.type}`, "Observation:", truncateObservation(observation)].join("\n");
}

function truncateObservation(value: string): string {
  return value.length > 6_000
    ? `[truncated ${value.length - 6_000} chars]\n${value.slice(-6_000)}`
    : value;
}

function getActionKey(action: ExecutableAgentAction): string {
  switch (action.type) {
    case "read":
      return `read:${action.path}`;
    case "glob":
      return `glob:${action.pattern}`;
    case "grep":
      return `grep:${action.pattern}:${action.include ?? ""}`;
    case "edit":
      return `edit:${action.filePath}:${action.oldString}:${action.newString}:${action.replaceAll ?? false}`;
    case "write":
      return `write:${action.filePath}:${action.content}`;
    case "apply_patch":
      return `apply_patch:${action.patchText}`;
    case "verify":
      return `verify:${action.command ?? ""}`;
    case "propose_patch":
      return `propose_patch:${action.patch}`;
  }
}

async function generateFinalTextOnlyResponse(
  input: {
    engine: PrimaryModelAdapter;
    agent?: AgentInfo;
    userMessage: string;
    systemContext?: string[];
    sessionContext?: string;
    onEvent?: (event: AgentRunEvent) => void;
  },
  observations: string[],
  runId: string,
): Promise<string> {
  const stepId = crypto.randomUUID();
  const agent = input.agent ?? getDefaultAgent();
  input.onEvent?.({
    type: "agent_step_started",
    payload: { runId, stepId, reason: "final_response" },
  });
  input.onEvent?.({ type: "assistant_started", payload: { runId, stepId } });

  try {
    const response = await input.engine.generateText({
      system: buildAgentSystemPrompt(agent, true, agentTurnSystemPrompt, input.systemContext),
      prompt: formatAgentTurnPrompt({
        agent,
        userMessage: input.userMessage,
        systemContext: input.systemContext,
        sessionContext: input.sessionContext,
        observations,
        iteration: 1,
        maxIterations: 1,
        isLastStep: true,
      }),
    });
    const action = validateAgentAction(parseJsonObjectFromText(response.text));
    const finalText =
      action.type === "answer"
        ? action.content
        : action.type === "finish"
          ? action.summary
          : summarizeStoppedTurn(observations);
    input.onEvent?.({
      type: "agent_step_ended",
      payload: { runId, stepId, status: "completed" },
    });

    return finalText;
  } catch (error) {
    input.onEvent?.({
      type: "provider_error",
      payload: {
        runId,
        stepId,
        message: error instanceof Error ? error.message : String(error),
        retryable: false,
      },
    });
    input.onEvent?.({ type: "agent_step_ended", payload: { runId, stepId, status: "failed" } });

    return summarizeStoppedTurn(observations);
  }
}

function formatUserMessageWithReminders(agent: AgentInfo, userMessage: string): string {
  if (agent.id !== "plan") {
    return userMessage;
  }

  return [userMessage, "", "<system-reminder>", MAGI_PLAN_REMINDER, "</system-reminder>"].join(
    "\n",
  );
}

function summarizeStoppedTurn(observations: string[]): string {
  if (observations.length === 0) {
    return "Agent reached the step limit before gathering observations. Try a narrower request or increase agent.maxIterations.";
  }

  return [
    "Agent reached the configured step limit before producing a final response.",
    "Useful observations gathered so far:",
    truncateObservation(observations.slice(-5).join("\n\n")),
    "Increase agent.maxIterations or ask a narrower follow-up if more work is needed.",
  ].join("\n\n");
}

function hasUnsettledTools(events: SessionEvent[]): boolean {
  const statuses = new Map<string, string>();

  for (const event of events) {
    if (event.type !== "tool_settlement") {
      continue;
    }

    const payload = event.payload as { toolCallId?: unknown; status?: unknown };

    if (typeof payload.toolCallId === "string" && typeof payload.status === "string") {
      statuses.set(payload.toolCallId, payload.status);
    }
  }

  for (const status of statuses.values()) {
    if (status === "pending" || status === "running") {
      return true;
    }
  }

  return false;
}
