import type { PrimaryModelAdapter } from "../model.js";
import type { AgentAction, ExecutableAgentAction } from "./actions.js";
import type { AgentInfo } from "./registry.js";
import { type AgentRunEvent, runEventDrivenAgent } from "./runner.js";

export type AgentTurnStep = {
  action: AgentAction;
  observation?: string;
};

export type AgentTurnResult = {
  status: "completed" | "max_iterations" | "interrupted";
  finalText: string;
  steps: AgentTurnStep[];
};

export type AgentTurnEvent = AgentRunEvent;

export async function runAgentTurn(input: {
  engine: PrimaryModelAdapter;
  agent?: AgentInfo;
  userMessage: string;
  systemContext?: string[];
  sessionContext?: string;
  executeAction: (action: ExecutableAgentAction) => Promise<string>;
  shouldInterrupt?: () => boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentTurnEvent) => void;
  maxIterations?: number;
}): Promise<AgentTurnResult> {
  const result = await runEventDrivenAgent(input);

  return {
    status: result.status,
    finalText: result.finalText,
    steps: result.steps,
  };
}
