import { afterEach, expect, it, vi } from "vitest";
import { createToolCall, runTool } from "../tools.js";
import { parseMcpTextResponse, selectProviders } from "./websearch.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("selects explicit and env websearch providers", () => {
  expect(selectProviders("brave")).toEqual(["brave"]);

  vi.stubEnv("MAGI_WEBSEARCH_PROVIDER", "parallel");
  expect(selectProviders()).toEqual(["parallel"]);
});

it("parses MCP direct and event-stream text responses", () => {
  const payload = JSON.stringify({ result: { content: [{ type: "text", text: "direct" }] } });
  const eventStream = `event: message\ndata: ${JSON.stringify({ result: { content: [{ type: "text", text: "stream" }] } })}\n`;

  expect(parseMcpTextResponse(payload)).toBe("direct");
  expect(parseMcpTextResponse(eventStream)).toBe("stream");
});

it("calls Exa MCP websearch", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  stubFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    return jsonResponse({ result: { content: [{ type: "text", text: "exa result" }] } });
  });

  const result = await runTool(
    createToolCall("websearch", { query: "magi", providerId: "exa", limit: 3 }),
    { workspaceRoot: process.cwd() },
  );

  expect(result.ok).toBe(true);
  expect(result.output).toContain("Provider: exa");
  expect(result.output).toContain("exa result");
  expect(calls[0]?.url).toBe("https://mcp.exa.ai/mcp");
  expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
    method: "tools/call",
    params: { name: "web_search_exa", arguments: { query: "magi", numResults: 3 } },
  });
});

it("falls back from Exa to Parallel when provider is automatic", async () => {
  let callCount = 0;
  stubFetch(async () => {
    callCount += 1;
    if (callCount === 1)
      return new Response("bad gateway", { status: 502, statusText: "Bad Gateway" });
    return jsonResponse({ result: { content: [{ type: "text", text: "parallel result" }] } });
  });

  const result = await runTool(createToolCall("websearch", { query: "magi" }), {
    workspaceRoot: process.cwd(),
  });

  expect(result.ok).toBe(true);
  expect(result.output).toContain("Provider: parallel");
  expect(result.output).toContain("parallel result");
});

it("does not fall back after caller cancellation", async () => {
  const controller = new AbortController();
  let callCount = 0;
  stubFetch(async (_url, init) => {
    callCount += 1;
    return await new Promise<Response>((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });

  const operation = runTool(createToolCall("websearch", { query: "magi" }), {
    workspaceRoot: process.cwd(),
    signal: controller.signal,
  });
  controller.abort();

  await expect(operation).rejects.toMatchObject({ name: "AbortError" });
  expect(callCount).toBe(1);
});

it("normalizes Brave websearch results", async () => {
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "secret");
  stubFetch(async () =>
    jsonResponse({
      web: {
        results: [{ title: "MAGI", url: "https://example.com", description: "Agent project" }],
      },
    }),
  );

  const result = await runTool(
    createToolCall("websearch", { query: "magi", providerId: "brave" }),
    { workspaceRoot: process.cwd() },
  );

  expect(result.ok).toBe(true);
  expect(result.output).toContain("Provider: brave");
  expect(result.output).toContain("1. MAGI");
  expect(result.output).toContain("https://example.com");
  expect(result.output).toContain("Agent project");
});

it("reports missing Brave API key", async () => {
  const result = await runTool(
    createToolCall("websearch", { query: "magi", providerId: "brave" }),
    { workspaceRoot: process.cwd() },
  );

  expect(result.ok).toBe(false);
  expect(result.error).toContain("Missing BRAVE_SEARCH_API_KEY");
});

function stubFetch(handler: (url: string | URL, init: RequestInit) => Promise<Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string | URL, init?: RequestInit) => handler(url, init ?? {})),
  );
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    statusText: "OK",
    headers: { "content-type": "application/json" },
  });
}
