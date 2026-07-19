import { applyPatchTool } from "./tools/apply-patch.js";
import { bashTool } from "./tools/bash.js";
import { editTool } from "./tools/edit.js";
import { globTool } from "./tools/glob.js";
import { grepTool } from "./tools/grep.js";
import { lspTool } from "./tools/lsp.js";
import { questionTool } from "./tools/question.js";
import { readTool } from "./tools/read.js";
import { createOkResult, truncateToolPreview } from "./tools/result.js";
import { skillTool } from "./tools/skill.js";
import { todowriteTool } from "./tools/todowrite.js";
import type {
  ToolCall,
  ToolName,
  ToolPermission,
  ToolResult,
  ToolRuntime,
  ToolSettlement,
  ToolSettlementStatus,
} from "./tools/types.js";
import { webfetchTool } from "./tools/webfetch.js";
import { websearchTool } from "./tools/websearch.js";
import { writeTool } from "./tools/write.js";

export type {
  ToolCall,
  ToolName,
  ToolPermission,
  ToolResult,
  ToolRuntime,
  ToolSettlement,
  ToolSettlementStatus,
} from "./tools/types.js";

export function getToolPermission(toolName: ToolName): ToolPermission {
  if (toolName === "bash") {
    return "shell";
  }

  if (toolName === "webfetch" || toolName === "websearch") {
    return "network";
  }

  if (toolName === "edit" || toolName === "write" || toolName === "apply_patch") {
    return "write";
  }

  return "read";
}

export function createToolCall(
  name: ToolName,
  input: unknown,
  id: string = crypto.randomUUID(),
): ToolCall {
  return {
    id,
    name,
    input,
  };
}

export function createToolSettlement(input: {
  call: ToolCall;
  status: ToolSettlementStatus;
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  result?: ToolResult;
}): ToolSettlement {
  return {
    toolCallId: input.call.id,
    name: input.call.name,
    status: input.status,
    input: input.call.input,
    ...(input.startedAt === undefined ? {} : { startedAt: input.startedAt }),
    ...(input.endedAt === undefined ? {} : { endedAt: input.endedAt }),
    ...(input.durationMs === undefined ? {} : { durationMs: input.durationMs }),
    ...(input.result?.output ? { outputPreview: truncateToolPreview(input.result.output) } : {}),
    ...(input.result?.error === undefined ? {} : { error: input.result.error }),
  };
}

export async function runTool(call: ToolCall, runtime: ToolRuntime): Promise<ToolResult> {
  try {
    switch (call.name) {
      case "read":
        return createOkResult(call, readTool(call.input, runtime));
      case "glob":
        return createOkResult(call, globTool(call.input, runtime));
      case "grep":
        return createOkResult(call, grepTool(call.input, runtime));
      case "edit":
        return createOkResult(call, editTool(call.input, runtime));
      case "write":
        return createOkResult(call, writeTool(call.input, runtime));
      case "apply_patch":
        return createOkResult(call, applyPatchTool(call.input, runtime));
      case "bash":
        return createOkResult(call, await bashTool(call.input, runtime));
      case "webfetch":
        return createOkResult(call, await webfetchTool(call.input, runtime));
      case "websearch":
        return createOkResult(call, await websearchTool(call.input, runtime));
      case "todowrite":
        return createOkResult(call, todowriteTool(call.input));
      case "question":
        return createOkResult(call, questionTool(call.input));
      case "skill":
        return createOkResult(call, skillTool(call.input, runtime.workspaceRoot));
      case "lsp_symbols":
      case "lsp_definition":
      case "lsp_references":
      case "lsp_hover":
      case "lsp_call_hierarchy":
        return createOkResult(call, await lspTool(call.name, call.input, runtime));
      case "task":
        throw new Error("task is executed by the agent runner, not the core tool runtime.");
      case "plan_exit":
        throw new Error("plan_exit is executed by the TUI controller, not the core tool runtime.");
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }

    return {
      id: call.id,
      name: call.name,
      ok: false,
      output: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
