import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAICodexOAuthFetch, OPENAI_CODEX_API_ENDPOINT } from "./openai-codex-oauth.js";

describe("OpenAI Codex OAuth fetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MAGI_AUTH_CONTENT;
    vi.restoreAllMocks();
  });

  it("rewrites responses requests and injects MAGI headers", async () => {
    process.env.MAGI_AUTH_CONTENT = JSON.stringify({
      openai: {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
        accountId: "account-id",
      },
    });
    const fetchMock = vi.fn(async () => new Response("ok"));
    globalThis.fetch = fetchMock;

    const oauthFetch = createOpenAICodexOAuthFetch({
      workspaceRoot: "/workspace",
      sessionId: "session-1",
    });

    await oauthFetch("https://api.openai.com/v1/responses", {
      headers: { Authorization: "Bearer old", "x-test": "1" },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const headers = init.headers as Headers;

    expect(url.toString()).toBe(OPENAI_CODEX_API_ENDPOINT);
    expect(headers.get("authorization")).toBe("Bearer access-token");
    expect(headers.get("ChatGPT-Account-Id")).toBe("account-id");
    expect(headers.get("originator")).toBe("magi");
    expect(headers.get("session-id")).toBe("session-1");
    expect(headers.get("User-Agent")).toContain("magi/0.0.0");
    expect(headers.get("x-test")).toBe("1");
  });
});
