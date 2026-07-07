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
      type: "assistant_status";
      payload: { runId: string; stepId: string; kind: "reasoning"; text: string };
    }
  | {
      type: "assistant_stream";
      payload:
        | { runId: string; stepId: string; kind: "text_delta"; text: string }
        | { runId: string; stepId: string; kind: "reasoning_start"; id: string }
        | { runId: string; stepId: string; kind: "reasoning_delta"; id: string; text: string }
        | { runId: string; stepId: string; kind: "reasoning_end"; id: string }
        | { runId: string; stepId: string; kind: "tool_input_start"; id: string; toolName: string }
        | { runId: string; stepId: string; kind: "tool_input_delta"; id: string; delta: string }
        | { runId: string; stepId: string; kind: "tool_input_end"; id: string }
        | {
            runId: string;
            stepId: string;
            kind: "tool_call";
            id: string;
            toolName: string;
            input: unknown;
          }
        | { runId: string; stepId: string; kind: "finish_step"; finishReason?: string };
    }
  | {
      type: "agent_step_ended";
      payload: {
        runId: string;
        stepId: string;
        status: "completed" | "waiting_for_tools" | "failed" | "interrupted";
      };
    }
  | {
      type: "agent_tool_skipped";
      payload: {
        runId: string;
        stepId: string;
        toolCallId?: string;
        toolName: string;
        input: unknown;
        reason: string;
      };
    }
  | {
      type: "provider_error";
      payload: {
        runId: string;
        stepId: string;
        message: string;
        retryable: boolean;
        debug?: unknown;
      };
    };

export type AgentRunResult = {
  status: "completed" | "max_iterations" | "interrupted";
  finalText: string;
  steps: AgentRunStep[];
};
