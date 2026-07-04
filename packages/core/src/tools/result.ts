import type { ToolCall, ToolResult } from "./types.js";

export function createOkResult(call: ToolCall, output: string): ToolResult {
  return {
    id: call.id,
    name: call.name,
    ok: true,
    output,
  };
}

export function truncateToolPreview(value: string): string {
  return value.length > 2_000 ? `${value.slice(0, 2_000)}\n[truncated]` : value;
}
