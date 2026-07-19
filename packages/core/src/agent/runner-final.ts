import type { PrimaryModelAdapter } from "../model.js";
import { isAbortError } from "./abort.js";
import { validateAgentAction } from "./actions.js";
import { parseJsonObjectFromText } from "./json.js";
import { type AgentInfo, getDefaultAgent } from "./registry.js";
import {
  agentTurnSystemPrompt,
  buildAgentSystemPrompt,
  formatAgentTurnPrompt,
  summarizeStoppedTurn,
} from "./runner-prompts.js";
import type { AgentRunEvent } from "./runner-types.js";

type FinalTextResponse =
  | { status: "completed"; text: string }
  | { status: "interrupted"; text: string };

export async function generateFinalTextOnlyResponse(
  input: {
    engine: PrimaryModelAdapter;
    agent?: AgentInfo;
    userMessage: string;
    systemContext?: string[];
    sessionContext?: string;
    onEvent?: (event: AgentRunEvent) => void;
    signal?: AbortSignal;
    shouldInterrupt?: () => boolean;
  },
  observations: string[],
  runId: string,
): Promise<FinalTextResponse> {
  const stepId = crypto.randomUUID();
  const agent = input.agent ?? getDefaultAgent();
  input.onEvent?.({
    type: "agent_step_started",
    payload: { runId, stepId, reason: "final_response" },
  });
  input.onEvent?.({ type: "assistant_started", payload: { runId, stepId } });

  try {
    const finalText = await callFinalTextModel(input, agent, observations);
    if (input.signal?.aborted || input.shouldInterrupt?.()) {
      input.onEvent?.({
        type: "agent_step_ended",
        payload: { runId, stepId, status: "interrupted" },
      });
      return { status: "interrupted", text: "Agent run interrupted." };
    }
    input.onEvent?.({ type: "agent_step_ended", payload: { runId, stepId, status: "completed" } });

    return { status: "completed", text: finalText };
  } catch (error) {
    if (isAbortError(error, input.signal)) {
      input.onEvent?.({
        type: "agent_step_ended",
        payload: { runId, stepId, status: "interrupted" },
      });
      return { status: "interrupted", text: "Agent run interrupted." };
    }

    input.onEvent?.({
      type: "provider_error",
      payload: { runId, stepId, message: formatError(error), retryable: false },
    });
    input.onEvent?.({ type: "agent_step_ended", payload: { runId, stepId, status: "failed" } });

    return { status: "completed", text: summarizeStoppedTurn(observations) };
  }
}

async function callFinalTextModel(
  input: {
    engine: PrimaryModelAdapter;
    userMessage: string;
    systemContext?: string[];
    sessionContext?: string;
    signal?: AbortSignal;
  },
  agent: AgentInfo,
  observations: string[],
): Promise<string> {
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
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const action = validateAgentAction(parseJsonObjectFromText(response.text));

  if (action.type === "answer") return action.content;
  if (action.type === "finish") return action.summary;
  return summarizeStoppedTurn(observations);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
