import { readOptionalPositiveInteger } from "./actions-input.js";

export type WebsearchAgentAction = {
  type: "websearch";
  query: string;
  providerId?: "exa" | "parallel" | "brave";
  limit?: number;
  searchType?: "auto" | "fast" | "deep";
  livecrawl?: "fallback" | "preferred";
  contextMaxCharacters?: number;
};

export function readWebsearchAction(action: Record<string, unknown>): WebsearchAgentAction {
  const providerId = readOptionalWebsearchProvider(action, "providerId");
  const searchType = readOptionalWebsearchType(action, "searchType");
  const livecrawl = readOptionalLivecrawl(action, "livecrawl");
  const limit = readOptionalPositiveInteger(action, "limit");
  const contextMaxCharacters = readOptionalPositiveInteger(action, "contextMaxCharacters");

  return {
    type: "websearch",
    query: readString(action, "query"),
    ...(providerId === undefined ? {} : { providerId }),
    ...(limit === undefined ? {} : { limit }),
    ...(searchType === undefined ? {} : { searchType }),
    ...(livecrawl === undefined ? {} : { livecrawl }),
    ...(contextMaxCharacters === undefined ? {} : { contextMaxCharacters }),
  };
}

function readOptionalWebsearchProvider(
  value: Record<string, unknown>,
  field: string,
): "exa" | "parallel" | "brave" | undefined {
  const fieldValue = readOptionalString(value, field);
  if (fieldValue === undefined) return undefined;

  if (fieldValue !== "exa" && fieldValue !== "parallel" && fieldValue !== "brave") {
    throw new Error(`${field} must be exa, parallel, or brave when provided.`);
  }

  return fieldValue;
}

function readOptionalWebsearchType(
  value: Record<string, unknown>,
  field: string,
): "auto" | "fast" | "deep" | undefined {
  const fieldValue = readOptionalString(value, field);
  if (fieldValue === undefined) return undefined;

  if (fieldValue !== "auto" && fieldValue !== "fast" && fieldValue !== "deep") {
    throw new Error(`${field} must be auto, fast, or deep when provided.`);
  }

  return fieldValue;
}

function readOptionalLivecrawl(
  value: Record<string, unknown>,
  field: string,
): "fallback" | "preferred" | undefined {
  const fieldValue = readOptionalString(value, field);
  if (fieldValue === undefined) return undefined;

  if (fieldValue !== "fallback" && fieldValue !== "preferred") {
    throw new Error(`${field} must be fallback or preferred when provided.`);
  }

  return fieldValue;
}

function readString(value: Record<string, unknown>, field: string): string {
  const fieldValue = value[field];

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string.`);
  }

  return fieldValue;
}

function readOptionalString(value: Record<string, unknown>, field: string): string | undefined {
  const fieldValue = value[field];

  if (fieldValue === undefined) return undefined;

  if (typeof fieldValue !== "string" || fieldValue.length === 0) {
    throw new Error(`${field} must be a non-empty string when provided.`);
  }

  return fieldValue;
}
