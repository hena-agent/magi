export type ToolName = "read" | "glob" | "grep" | "edit" | "write" | "apply_patch" | "bash";

export type ToolPermission = "read" | "write" | "shell";

export type ToolCall = {
  id: string;
  name: ToolName;
  input: unknown;
};

export type ToolResult = {
  id: string;
  name: ToolName;
  ok: boolean;
  output: string;
  error?: string;
};

export type ToolSettlementStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "denied"
  | "interrupted";

export type ToolSettlement = {
  toolCallId: string;
  name: ToolName;
  status: ToolSettlementStatus;
  input?: unknown;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  outputPreview?: string;
  error?: string;
};

export type ToolRuntime = {
  workspaceRoot: string;
};
