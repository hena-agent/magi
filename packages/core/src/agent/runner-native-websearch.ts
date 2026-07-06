import type { ExecutableAgentAction } from "./actions.js";

export function readWebsearchNativeAction(input: Record<string, unknown>): ExecutableAgentAction {
  const providerId = readOptionalWebsearchProvider(input, "providerId");
  const searchType = readOptionalWebsearchType(input, "type");
  const livecrawl = readOptionalLivecrawl(input, "livecrawl");
  const limit = readOptionalPositiveInteger(input, "limit");
  const contextMaxCharacters = readOptionalPositiveInteger(input, "contextMaxCharacters");

  return {
    type: "websearch",
    query: readString(input, "query"),
    ...(providerId === undefined ? {} : { providerId }),
    ...(limit === undefined ? {} : { limit }),
    ...(searchType === undefined ? {} : { searchType }),
    ...(livecrawl === undefined ? {} : { livecrawl }),
    ...(contextMaxCharacters === undefined ? {} : { contextMaxCharacters }),
  };
}

function readString(input: Record<string, unknown>, field: string): string {
  const value = input[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Native tool input requires string field: ${field}`);
  }

  return value;
}

function readOptionalString(input: Record<string, unknown>, field: string): string | undefined {
  const value = input[field];
  if (value === undefined) return undefined;

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Native tool input field must be a non-empty string: ${field}`);
  }

  return value;
}

function readOptionalPositiveInteger(
  input: Record<string, unknown>,
  field: string,
): number | undefined {
  if (input[field] === undefined) return undefined;

  return readPositiveInteger(input, field);
}

function readPositiveInteger(input: Record<string, unknown>, field: string): number {
  const value = input[field];

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`Native tool input field must be a positive integer: ${field}`);
  }

  return value;
}

function readOptionalWebsearchProvider(
  input: Record<string, unknown>,
  field: string,
): "exa" | "parallel" | "brave" | undefined {
  const value = readOptionalString(input, field);
  if (value === undefined) return undefined;

  if (value !== "exa" && value !== "parallel" && value !== "brave") {
    throw new Error(`Native tool input field must be exa, parallel, or brave: ${field}`);
  }

  return value;
}

function readOptionalWebsearchType(
  input: Record<string, unknown>,
  field: string,
): "auto" | "fast" | "deep" | undefined {
  const value = readOptionalString(input, field);
  if (value === undefined) return undefined;

  if (value !== "auto" && value !== "fast" && value !== "deep") {
    throw new Error(`Native tool input field must be auto, fast, or deep: ${field}`);
  }

  return value;
}

function readOptionalLivecrawl(
  input: Record<string, unknown>,
  field: string,
): "fallback" | "preferred" | undefined {
  const value = readOptionalString(input, field);
  if (value === undefined) return undefined;

  if (value !== "fallback" && value !== "preferred") {
    throw new Error(`Native tool input field must be fallback or preferred: ${field}`);
  }

  return value;
}
