import type { PrimaryModelAdapter } from "../model.js";
import type { AgentAction, ExecutableAgentAction } from "./actions.js";
import { validateAgentAction } from "./actions.js";
import { parseJsonObjectFromText } from "./json.js";
import { type AgentInfo, getDefaultAgent } from "./registry.js";
import { generateFinalTextOnlyResponse } from "./runner-final.js";
import { getNativeToolDefinitions, toolCallToAgentAction } from "./runner-native-tools.js";
import {
  agentTurnSystemPrompt,
  buildAgentSystemPrompt,
  formatAgentTurnPrompt,
  formatNativeToolPrompt,
  nativeToolSystemPrompt,
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
  actionCounts: Map<string, number>;
};

export async function runEventDrivenAgent(input: RunInput): Promise<AgentRunResult> {
  const agent = input.agent ?? getDefaultAgent();
  const maxIterations = input.maxIterations ?? agent.steps ?? 30;
  const state: RunState = {
    runId: crypto.randomUUID(),
    steps: [],
    observations: [],
    actionCounts: new Map(),
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

  const isLastStep = iteration >= maxIterations;
  const stepId = startStep(input, state, isLastStep);
  const action = await generateActionOrEmitFailure(
    input,
    state.runId,
    stepId,
    agent,
    state.observations,
    iteration,
    maxIterations,
  );
  const completed = await handleTerminalAction(input, state, stepId, action);

  if (completed) return completed;

  const executableAction = toExecutableAction(action);

  if (isLastStep) {
    return await handleFinalStep(input, state, stepId, executableAction);
  }

  await executeNonTerminalAction(input, state, stepId, executableAction);

  return undefined;
}

function startStep(input: RunInput, state: RunState, isLastStep: boolean): string {
  const stepId = crypto.randomUUID();
  const reason = isLastStep
    ? "final_response"
    : state.observations.length === 0
      ? "user_input"
      : "tool_result";
  input.onEvent?.({ type: "agent_step_started", payload: { runId: state.runId, stepId, reason } });
  input.onEvent?.({ type: "assistant_started", payload: { runId: state.runId, stepId } });

  return stepId;
}

async function generateActionOrEmitFailure(
  input: RunInput,
  runId: string,
  stepId: string,
  agent: AgentInfo,
  observations: string[],
  iteration: number,
  maxIterations: number,
): Promise<AgentAction> {
  try {
    return await generateAgentAction({
      engine: input.engine,
      agent,
      userMessage: input.userMessage,
      systemContext: input.systemContext,
      sessionContext: input.sessionContext,
      observations,
      iteration,
      maxIterations,
      isLastStep: iteration >= maxIterations,
    });
  } catch (error) {
    input.onEvent?.({
      type: "provider_error",
      payload: { runId, stepId, message: formatError(error), retryable: true },
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

async function handleTerminalAction(
  input: RunInput,
  state: RunState,
  stepId: string,
  action: AgentAction,
): Promise<AgentRunResult | undefined> {
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

async function handleFinalStep(
  input: RunInput,
  state: RunState,
  stepId: string,
  action: ExecutableAgentAction,
): Promise<AgentRunResult> {
  const observation =
    "Maximum agent steps reached. Tools are disabled on the final step; the model must provide a final answer.";
  state.steps.push({ action, observation });
  state.observations.push(formatObservation(action, observation));
  input.onEvent?.({
    type: "agent_step_ended",
    payload: { runId: state.runId, stepId, status: "completed" },
  });

  return {
    status: "max_iterations",
    finalText: await generateFinalTextOnlyResponse(input, state.observations, state.runId),
    steps: state.steps,
  };
}

async function executeNonTerminalAction(
  input: RunInput,
  state: RunState,
  stepId: string,
  action: ExecutableAgentAction,
): Promise<void> {
  const repeatedObservation = recordActionOccurrence(state.actionCounts, action);
  const observation = repeatedObservation ?? (await input.executeAction(action));
  state.steps.push({ action, observation });
  state.observations.push(formatObservation(action, observation));
  input.onEvent?.({
    type: "agent_step_ended",
    payload: { runId: state.runId, stepId, status: "waiting_for_tools" },
  });
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
  const nativeAction = await tryGenerateNativeToolAction(input);
  if (nativeAction) return nativeAction;

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

async function tryGenerateNativeToolAction(input: {
  engine: PrimaryModelAdapter;
  agent: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  observations: string[];
  iteration: number;
  maxIterations: number;
  isLastStep: boolean;
}): Promise<AgentAction | undefined> {
  if (input.isLastStep || !input.engine.generateStep) return undefined;

  try {
    const nativeResponse = await input.engine.generateStep({
      system: buildAgentSystemPrompt(
        input.agent,
        false,
        nativeToolSystemPrompt,
        input.systemContext,
      ),
      messages: [{ role: "user", content: formatNativeToolPrompt(input) }],
      tools: getNativeToolDefinitions(input.agent, input.engine.provider?.model),
      toolChoice: "auto",
    });
    const [toolCall] = nativeResponse.toolCalls;

    if (toolCall) return toolCallToAgentAction(toolCall);
    if (nativeResponse.text.trim().length > 0)
      return { type: "answer", content: nativeResponse.text };
  } catch {
    // Fall back to the JSON action protocol for providers without native tool-call support.
  }

  return undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
