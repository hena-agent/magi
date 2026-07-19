// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: OAuth fetch scenarios share global fetch and auth cleanup.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("passes model request cancellation to an automatic token refresh", async () => {
    process.env.MAGI_AUTH_CONTENT = JSON.stringify({
      openai: {
        type: "oauth",
        refresh: "refresh-token",
        access: "expired-token",
        expires: 0,
      },
    });
    const controller = new AbortController();
    let refreshSignal: AbortSignal | null | undefined;
    globalThis.fetch = vi.fn(async (request, init) => {
      if (String(request).includes("/oauth/token")) {
        refreshSignal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return new Response("unexpected");
    });

    const oauthFetch = createOpenAICodexOAuthFetch({ workspaceRoot: "/workspace" });
    const request = oauthFetch("https://api.openai.com/v1/responses", {
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(refreshSignal).toBeDefined());
    expect(refreshSignal).not.toBe(controller.signal);
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
    expect(refreshSignal?.aborted).toBe(true);
  });

  it("keeps a shared refresh alive while another caller is waiting", async () => {
    process.env.MAGI_AUTH_CONTENT = JSON.stringify({
      openai: {
        type: "oauth",
        refresh: "refresh-token",
        access: "expired-token",
        expires: 0,
      },
    });
    const firstController = new AbortController();
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-oauth-refresh-"));
    let refreshSignal: AbortSignal | null | undefined;
    let resolveRefresh: (response: Response) => void = () => undefined;
    globalThis.fetch = vi.fn(async (request, init) => {
      if (String(request).includes("/oauth/token")) {
        refreshSignal = init?.signal;
        return await new Promise<Response>((resolve, reject) => {
          resolveRefresh = resolve;
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        });
      }
      return new Response("ok");
    });

    const oauthFetch = createOpenAICodexOAuthFetch({ workspaceRoot });
    const firstRequest = oauthFetch("https://api.openai.com/v1/responses", {
      signal: firstController.signal,
    });
    const secondRequest = oauthFetch("https://api.openai.com/v1/responses");
    await vi.waitFor(() => expect(refreshSignal).toBeDefined());
    firstController.abort();

    await expect(firstRequest).rejects.toMatchObject({ name: "AbortError" });
    expect(refreshSignal?.aborted).toBe(false);
    resolveRefresh(
      new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh" })),
    );
    await expect(secondRequest).resolves.toMatchObject({ ok: true });
    rmSync(workspaceRoot, { recursive: true, force: true });
  });
});
