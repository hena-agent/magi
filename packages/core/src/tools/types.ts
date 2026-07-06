export type ToolName =
  | "read"
  | "glob"
  | "grep"
  | "edit"
  | "write"
  | "apply_patch"
  | "bash"
  | "webfetch"
  | "websearch"
  | "todowrite"
  | "question"
  | "skill"
  | "lsp_symbols"
  | "lsp_definition"
  | "lsp_references"
  | "lsp_hover"
  | "lsp_call_hierarchy"
  | "task"
  | "plan_exit";

export type ToolPermission = "read" | "write" | "shell" | "network";

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
