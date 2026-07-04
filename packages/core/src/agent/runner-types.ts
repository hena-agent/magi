import type { AgentAction } from "./actions.js";

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
