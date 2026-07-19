import { getOptionalStringField, getStringField, readObject } from "./input.js";
import type { ToolRuntime } from "./types.js";
import { fetchWebsearch } from "./websearch-fetch.js";
import { parseMcpTextResponse } from "./websearch-mcp.js";

export { parseMcpTextResponse } from "./websearch-mcp.js";

export type WebsearchProvider = "exa" | "parallel" | "brave";

type WebsearchInput = {
  query: string;
  providerId?: WebsearchProvider;
  limit?: number;
  type?: "auto" | "fast" | "deep";
  livecrawl?: "fallback" | "preferred";
  contextMaxCharacters?: number;
};

type SearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
};

const exaUrl = "https://mcp.exa.ai/mcp";
const parallelUrl = "https://search.parallel.ai/mcp";
const braveUrl = "https://api.search.brave.com/res/v1/web/search";

export async function websearchTool(input: unknown, runtime?: ToolRuntime): Promise<string> {
  const parsed = readWebsearchInput(input);
  const providers = selectProviders(parsed.providerId);
  const failures: string[] = [];

  for (const provider of providers) {
    try {
      return await callProvider(provider, parsed, runtime?.signal);
    } catch (error) {
      if (runtime?.signal?.aborted) {
        throw new DOMException("The operation was aborted", "AbortError");
      }

      failures.push(`${provider}: ${formatError(error)}`);
      if (parsed.providerId) break;
    }
  }

  throw new Error(`websearch failed. ${failures.join("; ")}`);
}

export function readWebsearchInput(input: unknown): WebsearchInput {
  const inputObject = readObject(
    input,
    ["query"],
    ["providerId", "limit", "type", "livecrawl", "contextMaxCharacters"],
  );
  const providerId = getOptionalStringField(inputObject, "providerId");
  const type = getOptionalStringField(inputObject, "type");
  const livecrawl = getOptionalStringField(inputObject, "livecrawl");
  const limit = readOptionalPositiveInteger(inputObject, "limit");
  const contextMaxCharacters = readOptionalPositiveInteger(inputObject, "contextMaxCharacters");

  if (providerId !== undefined && !isWebsearchProvider(providerId)) {
    throw new Error("websearch providerId must be exa, parallel, or brave");
  }

  if (type !== undefined && type !== "auto" && type !== "fast" && type !== "deep") {
    throw new Error("websearch type must be auto, fast, or deep");
  }

  if (livecrawl !== undefined && livecrawl !== "fallback" && livecrawl !== "preferred") {
    throw new Error("websearch livecrawl must be fallback or preferred");
  }

  return {
    query: getStringField(inputObject, "query"),
    ...(providerId === undefined ? {} : { providerId }),
    ...(limit === undefined ? {} : { limit }),
    ...(type === undefined ? {} : { type }),
    ...(livecrawl === undefined ? {} : { livecrawl }),
    ...(contextMaxCharacters === undefined ? {} : { contextMaxCharacters }),
  };
}

export function selectProviders(providerId?: WebsearchProvider): WebsearchProvider[] {
  if (providerId) return [providerId];

  const envProvider = process.env.MAGI_WEBSEARCH_PROVIDER;
  if (isWebsearchProvider(envProvider)) return [envProvider];

  return ["exa", "parallel", "brave"];
}

function isWebsearchProvider(value: unknown): value is WebsearchProvider {
  return value === "exa" || value === "parallel" || value === "brave";
}

async function callProvider(
  provider: WebsearchProvider,
  input: WebsearchInput,
  signal?: AbortSignal,
): Promise<string> {
  switch (provider) {
    case "exa":
      return await callExa(input, signal);
    case "parallel":
      return await callParallel(input, signal);
    case "brave":
      return await callBrave(input, signal);
  }
}

async function callExa(input: WebsearchInput, signal?: AbortSignal): Promise<string> {
  const url = process.env.EXA_API_KEY
    ? `${exaUrl}?exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
    : exaUrl;
  const text = await callMcpWebsearch(
    url,
    "web_search_exa",
    {
      query: input.query,
      type: input.type ?? "auto",
      numResults: input.limit ?? 8,
      livecrawl: input.livecrawl ?? "fallback",
      ...(input.contextMaxCharacters === undefined
        ? {}
        : { contextMaxCharacters: input.contextMaxCharacters }),
    },
    {},
    signal,
  );

  return formatTextResult("exa", input.query, text);
}

async function callParallel(input: WebsearchInput, signal?: AbortSignal): Promise<string> {
  const headers: Record<string, string> = process.env.PARALLEL_API_KEY
    ? { Authorization: `Bearer ${process.env.PARALLEL_API_KEY}` }
    : {};
  const text = await callMcpWebsearch(
    parallelUrl,
    "web_search",
    {
      objective: input.query,
      search_queries: [input.query],
    },
    headers,
    signal,
  );

  return formatTextResult("parallel", input.query, text);
}

async function callBrave(input: WebsearchInput, signal?: AbortSignal): Promise<string> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new Error("Missing BRAVE_SEARCH_API_KEY");
  }

  const url = new URL(braveUrl);
  url.searchParams.set("q", input.query);
  url.searchParams.set("count", String(input.limit ?? 8));
  const response = await fetchWebsearch(
    url,
    {
      headers: {
        Accept: "application/json",
        "X-Subscription-Token": apiKey,
        "User-Agent": `magi/0.0.0 (${process.platform}; ${process.arch})`,
      },
    },
    signal,
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Brave websearch failed: ${response.status} ${response.statusText}: ${body}`);
  }

  return formatBraveResult(input.query, body);
}

async function callMcpWebsearch(
  url: string,
  toolName: string,
  args: Record<string, unknown>,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetchWebsearch(
    url,
    {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "User-Agent": `magi/0.0.0 (${process.platform}; ${process.arch})`,
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    },
    signal,
  );
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`${toolName} failed: ${response.status} ${response.statusText}: ${body}`);
  }

  return parseMcpTextResponse(body) ?? "No search results found.";
}

function formatTextResult(provider: WebsearchProvider, query: string, text: string): string {
  return [`Provider: ${provider}`, `Query: ${query}`, "", text.trim()].join("\n").trim();
}

function formatBraveResult(query: string, body: string): string {
  const data = JSON.parse(body) as unknown;
  const results = readBraveResults(data);
  const lines = [`Provider: brave`, `Query: ${query}`, ""];

  if (results.length === 0) {
    return [...lines, "No search results found."].join("\n");
  }

  return [
    ...lines,
    ...results.map((result, index) => {
      return [
        `${index + 1}. ${result.title ?? "Untitled"}`,
        ...(result.url ? [`   ${result.url}`] : []),
        ...(result.snippet ? [`   ${result.snippet}`] : []),
      ].join("\n");
    }),
  ].join("\n");
}

function readBraveResults(data: unknown): SearchResult[] {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return [];

  const web = (data as Record<string, unknown>).web;
  if (typeof web !== "object" || web === null || Array.isArray(web)) return [];

  const results = (web as Record<string, unknown>).results;
  if (!Array.isArray(results)) return [];

  return results.flatMap((item): SearchResult[] => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];

    const record = item as Record<string, unknown>;
    return [
      {
        ...(typeof record.title === "string" ? { title: record.title } : {}),
        ...(typeof record.url === "string" ? { url: record.url } : {}),
        ...(typeof record.description === "string" ? { snippet: record.description } : {}),
      },
    ];
  });
}

function readOptionalPositiveInteger(
  input: Record<string, unknown>,
  field: string,
): number | undefined {
  const value = input[field];
  if (value === undefined) return undefined;

  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new Error(`websearch ${field} must be a positive integer`);
  }

  return value;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
