export type TranscriptToolStatus =
  | "pending"
  | "running"
  | "completed"
  | "error"
  | "denied"
  | "interrupted"
  | "skipped";

export type TranscriptPart =
  | { id: string; type: "text"; text: string; synthetic?: boolean }
  | {
      id: string;
      type: "reasoning";
      text: string;
      time: { start: number; end?: number };
    }
  | {
      id: string;
      type: "tool";
      tool: string;
      state: {
        status: TranscriptToolStatus;
        input?: unknown;
        output?: string;
        error?: string;
        title?: string;
        metadata?: {
          durationMs?: number;
          target?: string;
          countLabel?: string;
          summary?: string;
          preview?: string;
        };
        time: { start: number; end?: number };
      };
    }
  | {
      id: string;
      type: "status";
      text: string;
      tone?: "normal" | "muted" | "success" | "warning" | "danger";
    };

export type TranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  agentId?: string;
  providerId?: string;
  model?: string;
  createdAt?: number;
  completedAt?: number;
  parts: TranscriptPart[];
};
