// biome-ignore lint/style/noExcessiveLinesPerFile: runner flow is kept together until the event loop is split deliberately.
import type { ModelMessage, ModelStreamEvent, PrimaryModelAdapter } from "../model.js";
import type { AgentAction, ExecutableAgentAction } from "./actions.js";
import { validateAgentAction } from "./actions.js";
import { parseJsonObjectFromText } from "./json.js";
import { type AgentInfo, getDefaultAgent } from "./registry.js";
import { generateFinalTextOnlyResponse } from "./runner-final.js";
import { formatInvalidToolObservation } from "./runner-invalid-tool.js";
import { getNativeToolDefinitions, toolCallToAgentAction } from "./runner-native-tools.js";
import {
  agentTurnSystemPrompt,
  buildAgentSystemPrompt,
  formatAgentTurnPrompt,
  formatNativeToolPrompt,
  nativeToolSystemPrompt,
  summarizeStoppedTurn,
} from "./runner-prompts.js";
import type { AgentRunEvent, AgentRunResult, AgentRunStep } from "./runner-types.js";
import { formatObservation, getActionKey } from "./runner-utils.js";

export { getAgentRunContinuation } from "./runner-continuation.js";
export type {
  AgentRunContinuation,
  AgentRunContinuationReason,
  AgentRunEvent,
  AgentRunResult,
  AgentRunStep,
} from "./runner-types.js";

type RunInput = {
  engine: PrimaryModelAdapter;
  agent?: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  executeAction: (action: ExecutableAgentAction) => Promise<string>;
  shouldInterrupt?: () => boolean;
  onEvent?: (event: AgentRunEvent) => void;
  maxIterations?: number;
};

type RunState = {
  runId: string;
  steps: AgentRunStep[];
  observations: string[];
  nativeHistory: ModelMessage[];
  actionCounts: Map<string, number>;
  taskActionCount: number;
  broadGlobScopes: Set<string>;
  grepTokenSets: Set<string>[];
};

type ActionExecutionResult = {
  action: ExecutableAgentAction;
  observation: string;
  skipped: boolean;
};

export async function runEventDrivenAgent(input: RunInput): Promise<AgentRunResult> {
  const agent = input.agent ?? getDefaultAgent();
  const maxIterations = input.maxIterations ?? agent.steps ?? 30;
  const state: RunState = {
    runId: crypto.randomUUID(),
    steps: [],
    observations: [],
    nativeHistory: [],
    actionCounts: new Map(),
    taskActionCount: 0,
    broadGlobScopes: new Set(),
    grepTokenSets: [],
  };

  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const result = await runAgentIteration(input, state, agent, iteration, maxIterations);
    if (result) return result;
  }

  return {
    status: "max_iterations",
    finalText: await generateFinalTextOnlyResponse(input, state.observations, state.runId),
    steps: state.steps,
  };
}

async function runAgentIteration(
  input: RunInput,
  state: RunState,
  agent: AgentInfo,
  iteration: number,
  maxIterations: number,
): Promise<AgentRunResult | undefined> {
  if (input.shouldInterrupt?.()) {
    return { status: "interrupted", finalText: "Agent run interrupted.", steps: state.steps };
  }

  const stepId = startStep(input, state);
  const actions = await generateActionsOrEmitFailure(
    input,
    state.runId,
    stepId,
    agent,
    state.observations,
    state.nativeHistory,
    iteration,
    maxIterations,
    false,
  );
  const completed = await handleTerminalActions(input, state, stepId, actions);

  if (completed) return completed;

  const executableActions = actions.map(toExecutableAction);

  const completedAfterActions = await executeNonTerminalActions(
    input,
    state,
    agent,
    stepId,
    executableActions,
    iteration >= maxIterations,
  );
  if (completedAfterActions) return completedAfterActions;

  return undefined;
}

function startStep(input: RunInput, state: RunState): string {
  const stepId = crypto.randomUUID();
  const reason = state.observations.length === 0 ? "user_input" : "tool_result";
  input.onEvent?.({ type: "agent_step_started", payload: { runId: state.runId, stepId, reason } });
  input.onEvent?.({ type: "assistant_started", payload: { runId: state.runId, stepId } });

  return stepId;
}

async function generateActionsOrEmitFailure(
  input: RunInput,
  runId: string,
  stepId: string,
  agent: AgentInfo,
  observations: string[],
  nativeHistory: ModelMessage[],
  iteration: number,
  maxIterations: number,
  isLastStep: boolean,
): Promise<AgentAction[]> {
  try {
    return await generateAgentActions({
      engine: input.engine,
      agent,
      userMessage: input.userMessage,
      systemContext: input.systemContext,
      sessionContext: input.sessionContext,
      observations,
      nativeHistory,
      iteration,
      maxIterations,
      isLastStep,
      onStatus: (text) =>
        input.onEvent?.({
          type: "assistant_status",
          payload: { runId, stepId, kind: "reasoning", text },
        }),
      onStream: (event) => {
        input.onEvent?.(modelStreamEventToRunEvent(event, runId, stepId));
      },
    });
  } catch (error) {
    input.onEvent?.({
      type: "provider_error",
      payload: {
        runId,
        stepId,
        message: formatError(error),
        retryable: true,
      },
    });
    input.onEvent?.({ type: "agent_step_ended", payload: { runId, stepId, status: "failed" } });
    throw error;
  }
}

function toExecutableAction(action: AgentAction): ExecutableAgentAction {
  if (action.type === "answer" || action.type === "finish") {
    throw new Error(`Terminal action cannot be executed: ${action.type}`);
  }

  return action;
}

async function handleTerminalActions(
  input: RunInput,
  state: RunState,
  stepId: string,
  actions: AgentAction[],
): Promise<AgentRunResult | undefined> {
  const [action] = actions;
  if (actions.length !== 1 || !action) return undefined;
  if (action.type !== "answer" && action.type !== "finish") return undefined;

  state.steps.push({ action });
  input.onEvent?.({
    type: "agent_step_ended",
    payload: { runId: state.runId, stepId, status: "completed" },
  });

  return {
    status: "completed",
    finalText: action.type === "answer" ? action.content : action.summary,
    steps: state.steps,
  };
}

async function executeNonTerminalActions(
  input: RunInput,
  state: RunState,
  agent: AgentInfo,
  stepId: string,
  actions: ExecutableAgentAction[],
  isFinalConfiguredIteration: boolean,
): Promise<AgentRunResult | undefined> {
  const results = canExecuteActionsInParallel(actions)
    ? await Promise.all(
        actions.map((action) => executeOneNonTerminalAction(input, state, agent, stepId, action)),
      )
    : await executeActionsSequentially(input, state, agent, stepId, actions);

  for (const { action, observation } of results) {
    state.steps.push({ action, observation });
    state.observations.push(formatObservation(action, observation));
  }
  appendNativeToolResults(state, results);

  if (results.length > 0 && results.every((result) => result.skipped)) {
    input.onEvent?.({
      type: "agent_step_ended",
      payload: { runId: state.runId, stepId, status: "completed" },
    });

    return {
      status: isFinalConfiguredIteration ? "max_iterations" : "completed",
      finalText: await generateFinalTextOnlyResponse(input, state.observations, state.runId),
      steps: state.steps,
    };
  }

  input.onEvent?.({
    type: "agent_step_ended",
    payload: { runId: state.runId, stepId, status: "waiting_for_tools" },
  });
  return undefined;
}

async function executeActionsSequentially(
  input: RunInput,
  state: RunState,
  agent: AgentInfo,
  stepId: string,
  actions: ExecutableAgentAction[],
): Promise<ActionExecutionResult[]> {
  const results: ActionExecutionResult[] = [];

  for (const action of actions) {
    results.push(await executeOneNonTerminalAction(input, state, agent, stepId, action));
  }

  return results;
}

function appendNativeToolResults(state: RunState, results: ActionExecutionResult[]): void {
  for (const { action, observation, skipped } of results) {
    if (!action.toolCallId) continue;
    state.nativeHistory.push({
      role: "tool",
      toolCallId: action.toolCallId,
      content: [
        {
          type: "tool-result",
          id: action.toolCallId,
          name: getActionToolName(action),
          result: skipped
            ? { type: "error", value: observation }
            : { type: "text", value: observation },
        },
      ],
    });
  }
}

async function executeOneNonTerminalAction(
  input: RunInput,
  state: RunState,
  agent: AgentInfo,
  stepId: string,
  action: ExecutableAgentAction,
): Promise<ActionExecutionResult> {
  const guardedObservation = recordGuardedActionOccurrence(state, agent, action);
  const repeatedObservation = recordActionOccurrence(state.actionCounts, action);
  const skipReason = guardedObservation ?? repeatedObservation;

  if (skipReason !== undefined) {
    input.onEvent?.({
      type: "agent_tool_skipped",
      payload: {
        runId: state.runId,
        stepId,
        ...(action.toolCallId === undefined ? {} : { toolCallId: action.toolCallId }),
        toolName: getActionToolName(action),
        input: getActionToolInput(action),
        reason: skipReason,
      },
    });

    return { action, observation: skipReason, skipped: true };
  }

  const observation =
    action.type === "invalid_tool"
      ? formatInvalidToolObservation(action)
      : await input.executeAction(action);

  return { action, observation, skipped: false };
}

function canExecuteActionsInParallel(actions: ExecutableAgentAction[]): boolean {
  return actions.length > 1 && actions.every(isParallelSafeAction);
}

function isParallelSafeAction(action: ExecutableAgentAction): boolean {
  return (
    action.type === "read" ||
    action.type === "glob" ||
    action.type === "grep" ||
    action.type === "lsp_symbols" ||
    action.type === "lsp_definition" ||
    action.type === "lsp_references" ||
    action.type === "lsp_hover" ||
    action.type === "lsp_call_hierarchy" ||
    action.type === "invalid_tool"
  );
}

function recordActionOccurrence(
  actionCounts: Map<string, number>,
  action: ExecutableAgentAction,
): string | undefined {
  const actionKey = getActionKey(action);
  const actionCount = actionCounts.get(actionKey) ?? 0;
  actionCounts.set(actionKey, actionCount + 1);

  return actionCount > 0
    ? "Repeated action skipped. Do not repeat actions that already ran; choose a different action or finish with the available observations."
    : undefined;
}

function recordGuardedActionOccurrence(
  state: RunState,
  agent: AgentInfo,
  action: ExecutableAgentAction,
): string | undefined {
  if (agent.id === "plan" && action.type === "task") {
    state.taskActionCount += 1;
    return state.taskActionCount > 1
      ? "Additional subagent task skipped. Plan mode may launch only one focused subagent per run; use the existing subagent result or finish with available observations."
      : undefined;
  }

  if (action.type === "glob") return recordGlobSearchOccurrence(state, action.pattern);
  if (action.type === "grep") return recordGrepSearchOccurrence(state, action.pattern);

  return undefined;
}

function recordGlobSearchOccurrence(state: RunState, pattern: string): string | undefined {
  const scope = normalizeGlobScope(pattern);
  if (scope === undefined) return undefined;

  if (state.broadGlobScopes.has(scope)) {
    return "Similar broad glob skipped. Use existing file search results or switch to a specific read/answer instead of repeating broad discovery.";
  }

  state.broadGlobScopes.add(scope);
  return undefined;
}

function recordGrepSearchOccurrence(state: RunState, pattern: string): string | undefined {
  const tokens = tokenizeSearchPattern(pattern);
  if (tokens.size < 3) return undefined;

  const repeated = state.grepTokenSets.some((existing) => tokenOverlap(existing, tokens) >= 0.6);
  if (repeated) {
    return "Similar grep skipped. Use existing search results or choose a more specific read/answer instead of repeating overlapping searches.";
  }

  state.grepTokenSets.push(tokens);
  return undefined;
}

function normalizeGlobScope(pattern: string): string | undefined {
  const normalized = pattern.toLowerCase().replace(/\\/g, "/");
  if (!normalized.includes("**")) return undefined;
  if (/^\*\*\//.test(normalized)) return "workspace";

  const scope = normalized.split("**", 1)[0]?.replace(/\/+$/, "");
  return scope && scope.length > 0 ? scope : "workspace";
}

function tokenizeSearchPattern(pattern: string): Set<string> {
  const ignored = new Set(["use", "get", "set", "src", "tsx", "typescript"]);
  return new Set(
    pattern
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((token) => token.length >= 3 && !ignored.has(token)),
  );
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  const smaller = left.size <= right.size ? left : right;
  const larger = left.size <= right.size ? right : left;
  let shared = 0;

  for (const token of smaller) {
    if (larger.has(token)) shared += 1;
  }

  return smaller.size === 0 ? 0 : shared / smaller.size;
}

function getActionToolName(action: ExecutableAgentAction): string {
  if (action.type === "verify") return "bash";
  if (action.type === "invalid_tool") return action.toolName;
  return action.type;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: This mirrors the action union in one auditable switch.
function getActionToolInput(action: ExecutableAgentAction): unknown {
  switch (action.type) {
    case "read":
      return { path: action.path };
    case "glob":
      return { pattern: action.pattern };
    case "grep":
      return {
        pattern: action.pattern,
        ...(action.include === undefined ? {} : { include: action.include }),
      };
    case "edit":
      return {
        filePath: action.filePath,
        oldString: action.oldString,
        newString: action.newString,
        ...(action.replaceAll === undefined ? {} : { replaceAll: action.replaceAll }),
      };
    case "write":
      return { filePath: action.filePath, content: action.content };
    case "apply_patch":
      return { patchText: action.patchText };
    case "webfetch":
      return {
        url: action.url,
        ...(action.format === undefined ? {} : { format: action.format }),
        ...(action.timeout === undefined ? {} : { timeout: action.timeout }),
      };
    case "websearch":
      return action;
    case "todowrite":
      return { todos: action.todos };
    case "question":
      return { questions: action.questions };
    case "skill":
      return { name: action.name };
    case "lsp_symbols":
      return { filePath: action.filePath };
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover":
      return { filePath: action.filePath, line: action.line, character: action.character };
    case "lsp_call_hierarchy":
      return {
        filePath: action.filePath,
        line: action.line,
        character: action.character,
        ...(action.direction === undefined ? {} : { direction: action.direction }),
      };
    case "task":
      return action;
    case "plan_exit":
      return {};
    case "invalid_tool":
      return action.input;
    case "verify":
      return { command: action.command ?? "" };
    case "propose_patch":
      return {
        patch: action.patch,
        ...(action.summary === undefined ? {} : { summary: action.summary }),
      };
  }
}

async function generateAgentActions(input: {
  engine: PrimaryModelAdapter;
  agent: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  observations: string[];
  nativeHistory: ModelMessage[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
  onStatus?: (text: string) => void;
  onStream?: (event: ModelStreamEvent) => void;
}): Promise<AgentAction[]> {
  const nativeActions = await tryGenerateNativeToolActions(input);
  if (nativeActions) return nativeActions;

  const response = await input.engine.generateText({
    system: buildAgentSystemPrompt(
      input.agent,
      input.isLastStep,
      agentTurnSystemPrompt,
      input.systemContext,
    ),
    prompt: formatAgentTurnPrompt({ ...input, model: input.engine.provider?.model }),
  });

  const action = validateAgentAction(parseJsonObjectFromText(response.text));
  if (input.isLastStep && action.type !== "answer" && action.type !== "finish") {
    return [{ type: "finish", summary: summarizeStoppedTurn(input.observations) }];
  }

  return [action];
}

async function tryGenerateNativeToolActions(input: {
  engine: PrimaryModelAdapter;
  agent: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  observations: string[];
  nativeHistory: ModelMessage[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
  onStatus?: (text: string) => void;
  onStream?: (event: ModelStreamEvent) => void;
}): Promise<AgentAction[] | undefined> {
  if (input.isLastStep || !input.engine.generateStep) return undefined;

  try {
    if (input.nativeHistory.length === 0) {
      input.nativeHistory.push({ role: "user", content: formatNativeToolPrompt(input) });
    }

    const nativeResponse = await input.engine.generateStep({
      system: buildAgentSystemPrompt(
        input.agent,
        false,
        nativeToolSystemPrompt,
        input.systemContext,
      ),
      messages: input.nativeHistory,
      tools: getNativeToolDefinitions(input.agent, input.engine.provider?.model),
      toolChoice: "auto",
      onStreamEvent(event) {
        input.onStream?.(event);
      },
    });
    const content = nativeResponse.content ?? [];
    if (content.length > 0) {
      input.nativeHistory.push({ role: "assistant", content });
    }
    if (nativeResponse.reasoningText?.trim()) {
      input.onStatus?.(nativeResponse.reasoningText);
      if ((nativeResponse.streamStats?.reasoningDeltaCount ?? 0) === 0) {
        const reasoningId = crypto.randomUUID();
        input.onStream?.({ type: "reasoning_start", id: reasoningId });
        input.onStream?.({
          type: "reasoning_delta",
          id: reasoningId,
          text: nativeResponse.reasoningText,
        });
        input.onStream?.({ type: "reasoning_end", id: reasoningId });
      }
    }
    if (
      nativeResponse.text.trim().length > 0 &&
      (nativeResponse.streamStats?.textDeltaCount ?? 0) === 0
    ) {
      input.onStream?.({ type: "text_delta", text: nativeResponse.text });
    }
    if (nativeResponse.toolCalls.length > 0) {
      return nativeResponse.toolCalls.map(toolCallToAgentAction);
    }
    if (nativeResponse.text.trim().length > 0)
      return [{ type: "answer", content: nativeResponse.text }];
  } catch (_error) {
    // Fall back to the JSON action protocol for providers without native tool-call support.
  }

  return undefined;
}

function modelStreamEventToRunEvent(
  event: ModelStreamEvent,
  runId: string,
  stepId: string,
): Extract<AgentRunEvent, { type: "assistant_stream" }> {
  switch (event.type) {
    case "text_delta":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "text_delta", text: event.text },
      };
    case "reasoning_start":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "reasoning_start", id: event.id },
      };
    case "reasoning_delta":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "reasoning_delta", id: event.id, text: event.text },
      };
    case "reasoning_end":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "reasoning_end", id: event.id },
      };
    case "tool_input_start":
      return {
        type: "assistant_stream",
        payload: {
          runId,
          stepId,
          kind: "tool_input_start",
          id: event.id,
          toolName: event.toolName,
        },
      };
    case "tool_input_delta":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "tool_input_delta", id: event.id, delta: event.delta },
      };
    case "tool_input_end":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "tool_input_end", id: event.id },
      };
    case "tool_call":
      return {
        type: "assistant_stream",
        payload: {
          runId,
          stepId,
          kind: "tool_call",
          id: event.id,
          toolName: event.toolName,
          input: event.input,
        },
      };
    case "finish_step":
      return {
        type: "assistant_stream",
        payload: { runId, stepId, kind: "finish_step", finishReason: event.finishReason },
      };
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
