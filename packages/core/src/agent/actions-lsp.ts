import { readPositiveInteger } from "./actions-input.js";

export type LspPositionAgentAction =
  | { type: "lsp_definition"; filePath: string; line: number; character: number }
  | { type: "lsp_references"; filePath: string; line: number; character: number }
  | { type: "lsp_hover"; filePath: string; line: number; character: number }
  | {
      type: "lsp_call_hierarchy";
      filePath: string;
      line: number;
      character: number;
      direction?: "incoming" | "outgoing" | "both";
    };

export type LspPositionActionType = LspPositionAgentAction["type"];

export function isLspPositionActionType(type: string): type is LspPositionActionType {
  return (
    type === "lsp_definition" ||
    type === "lsp_references" ||
    type === "lsp_hover" ||
    type === "lsp_call_hierarchy"
  );
}

export function readLspPositionAction(
  action: Record<string, unknown>,
  type: LspPositionActionType,
): LspPositionAgentAction {
  const direction = readOptionalLspCallHierarchyDirection(action);

  return {
    type,
    filePath: readString(action, "filePath"),
    line: readPositiveInteger(action, "line"),
    character: readPositiveInteger(action, "character"),
    ...(type === "lsp_call_hierarchy" && direction !== undefined ? { direction } : {}),
  };
}

function readOptionalLspCallHierarchyDirection(
  action: Record<string, unknown>,
): "incoming" | "outgoing" | "both" | undefined {
  const direction = action.direction;
  if (direction === undefined) return undefined;
  if (direction === "incoming" || direction === "outgoing" || direction === "both") {
    return direction;
  }

  throw new Error("direction must be incoming, outgoing, or both when provided.");
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return fieldValue;
}
