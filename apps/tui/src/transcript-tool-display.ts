// biome-ignore-all lint/complexity/noExcessiveCognitiveComplexity: Tool-specific display summaries are clearer as an exhaustive switch.
// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Tool-specific display summaries stay together to preserve formatting behavior.
import type { ToolResult } from "@magi/core";
import {
  formatOutputPreview,
  formatOutputSummary,
  formatPatchTargets,
  readInputString,
  truncateOneLine,
} from "./display-format.js";
import type { TranscriptPart } from "./transcript-types.js";

export type ToolDisplaySummary = {
  content: string;
  target?: string;
  countLabel?: string;
  summary?: string;
  preview?: string;
};

export function parseJsonInput(value: string | undefined): unknown {
  if (!value) return undefined;

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function formatToolInputTarget(toolName: string, input: unknown): string | undefined {
  switch (toolName) {
    case "bash":
      return readInputString(input, "command");
    case "read":
      return readInputString(input, "filePath") ?? readInputString(input, "path");
    case "grep":
    case "glob":
      return readInputString(input, "pattern");
    case "webfetch":
      return readInputString(input, "url");
    case "websearch":
      return readInputString(input, "query");
    case "write":
    case "edit":
      return readInputString(input, "filePath");
    case "task":
      return readInputString(input, "description");
    default:
      return undefined;
  }
}

export function createToolPartFromInput(
  id: string,
  toolName: string,
  input: unknown,
  status: "pending" | "running",
  startedAtMs: number,
): TranscriptPart {
  const target = formatToolInputTarget(toolName, input);
  return {
    id,
    type: "tool",
    tool: toolName,
    state: {
      status,
      input,
      metadata: target ? { target } : undefined,
      time: { start: startedAtMs },
    },
  };
}

export function formatToolResultSummary(result: ToolResult, input: unknown): ToolDisplaySummary {
  if (!result.ok) {
    return {
      content: "failed",
      summary: result.error ? truncateOneLine(result.error) : undefined,
    };
  }

  const output = result.output.trim();
  switch (result.name) {
    case "read": {
      const path = readInputString(input, "path") ?? "file";
      const lineCount = output.length === 0 ? 0 : output.split("\n").length;
      return {
        content: "file read complete",
        target: path,
        countLabel: `${lineCount} lines, ${result.output.length} chars`,
        preview: formatOutputPreview(result.output),
      };
    }
    case "glob": {
      const pattern = readInputString(input, "pattern") ?? "pattern";
      const matches = output.length === 0 ? 0 : output.split("\n").length;
      return {
        content: "glob complete",
        target: pattern,
        countLabel: `${matches} matches`,
        preview: formatOutputPreview(result.output),
      };
    }
    case "grep": {
      const pattern = readInputString(input, "pattern") ?? "pattern";
      const include = readInputString(input, "include");
      const matches = output.length === 0 ? 0 : output.split("\n").length;
      return {
        content: "search complete",
        target: include ? `${pattern} in ${include}` : pattern,
        countLabel: `${matches} matches`,
        preview: formatOutputPreview(result.output),
      };
    }
    case "bash": {
      const command = readInputString(input, "command") ?? "command";
      return {
        content: "command complete",
        target: command,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "webfetch": {
      const url = readInputString(input, "url") ?? "url";
      return {
        content: "fetched URL",
        target: url,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "websearch": {
      const query = readInputString(input, "query") ?? "query";
      return {
        content: "web search complete",
        target: query,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "lsp_symbols":
    case "lsp_definition":
    case "lsp_references":
    case "lsp_hover":
    case "lsp_call_hierarchy": {
      const filePath = readInputString(input, "filePath") ?? "file";
      return {
        content: "LSP query complete",
        target: filePath,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    case "apply_patch":
      return {
        content: "workspace updated",
        target: formatPatchTargets(input) ?? "patch",
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    case "edit":
    case "write": {
      const filePath = readInputString(input, "filePath") ?? "file";
      return {
        content: "workspace updated",
        target: filePath,
        summary: formatOutputSummary(result.output),
        preview: formatOutputPreview(result.output),
      };
    }
    default:
      return { content: "tool complete", summary: formatOutputSummary(result.output) };
  }
}
