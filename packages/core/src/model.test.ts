import { afterEach, describe, expect, it, vi } from "vitest";
import { createPrimaryModelAdapter } from "./model.js";

describe("createPrimaryModelAdapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    delete process.env.MAGI_AUTH_CONTENT;
    vi.restoreAllMocks();
  });

  it("falls back to built-in OpenAI OAuth providers", () => {
    const adapter = createPrimaryModelAdapter({ workspaceRoot: process.cwd(), modelProviders: [] });

    expect(adapter.provider).toMatchObject({ id: "openai", model: "gpt-5.5" });
  });

  it("rejects unsupported Phase 1 providers", () => {
    expect(() =>
      createPrimaryModelAdapter({
        modelProviders: [{ id: "primary", provider: "anthropic", model: "claude" }],
      }),
    ).toThrow(/Unsupported model provider/);
  });

  it("requires configured API key environment variables", () => {
    expect(() =>
      createPrimaryModelAdapter({
        modelProviders: [
          {
            id: "primary",
            provider: "openai",
            model: "gpt-4.1-mini",
            apiKeyEnv: "MAGI_TEST_MISSING_KEY",
          },
        ],
      }),
    ).toThrow(/Missing MAGI_TEST_MISSING_KEY/);
  });

  it("creates a DeepSeek adapter as an OpenAI-compatible provider", () => {
    process.env.MAGI_TEST_DEEPSEEK_KEY = "test-key";

    expect(() =>
      createPrimaryModelAdapter({
        modelProviders: [
          {
            id: "primary",
            provider: "deepseek",
            model: "deepseek-v4-pro",
            apiKeyEnv: "MAGI_TEST_DEEPSEEK_KEY",
          },
        ],
      }),
    ).not.toThrow();

    delete process.env.MAGI_TEST_DEEPSEEK_KEY;
  });

  it("creates a custom OpenAI-compatible adapter", () => {
    process.env.MAGI_TEST_CUSTOM_KEY = "test-key";

    expect(() =>
      createPrimaryModelAdapter({
        modelProviders: [
          {
            id: "primary",
            provider: "custom",
            model: "custom-model",
            apiKeyEnv: "MAGI_TEST_CUSTOM_KEY",
            baseUrl: "https://example.com/v1",
          },
        ],
      }),
    ).not.toThrow();

    delete process.env.MAGI_TEST_CUSTOM_KEY;
  });

  it("creates an OpenAI OAuth adapter without apiKeyEnv", () => {
    expect(() =>
      createPrimaryModelAdapter({
        workspaceRoot: process.cwd(),
        modelProviders: [
          {
            id: "openai",
            provider: "openai",
            model: "gpt-5.5",
            auth: { type: "oauth" },
          },
        ],
      }),
    ).not.toThrow();
  });

  it("requires workspaceRoot for OpenAI OAuth adapters", () => {
    expect(() =>
      createPrimaryModelAdapter({
        modelProviders: [
          {
            id: "openai",
            provider: "openai",
            model: "gpt-5.5",
            auth: { type: "oauth" },
          },
        ],
      }),
    ).toThrow(/workspaceRoot/);
  });

  it("selects a configured provider by id", () => {
    process.env.MAGI_TEST_SELECTED_KEY = "test-key";

    const adapter = createPrimaryModelAdapter({
      selectedProviderId: "selected",
      modelProviders: [
        {
          id: "first",
          provider: "custom",
          model: "first-model",
          apiKeyEnv: "MAGI_TEST_SELECTED_KEY",
        },
        {
          id: "selected",
          provider: "custom",
          model: "selected-model",
          apiKeyEnv: "MAGI_TEST_SELECTED_KEY",
        },
      ],
    });

    expect(adapter.provider).toMatchObject({ id: "selected", model: "selected-model" });
    delete process.env.MAGI_TEST_SELECTED_KEY;
  });

  it("rejects unknown selected providers", () => {
    expect(() =>
      createPrimaryModelAdapter({
        selectedProviderId: "missing",
        modelProviders: [{ id: "first", provider: "custom", model: "first-model" }],
      }),
    ).toThrow(/Model provider not configured: missing/);
  });

  it("selects built-in OpenAI OAuth providers even when config only contains another provider", () => {
    process.env.MAGI_TEST_BUILTIN_SELECT_KEY = "test-key";

    const adapter = createPrimaryModelAdapter({
      workspaceRoot: process.cwd(),
      selectedProviderId: "openai",
      modelProviders: [
        {
          id: "primary",
          provider: "deepseek",
          model: "deepseek-v4-pro",
          apiKeyEnv: "MAGI_TEST_BUILTIN_SELECT_KEY",
        },
      ],
    });

    expect(adapter.provider).toMatchObject({ id: "openai", model: "gpt-5.5" });
    delete process.env.MAGI_TEST_BUILTIN_SELECT_KEY;
  });

  it("sets store=false for OpenAI Codex OAuth responses requests", async () => {
    process.env.MAGI_AUTH_CONTENT = JSON.stringify({
      openai: {
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: Date.now() + 60_000,
      },
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            id: "response-id",
            object: "response",
            created_at: 0,
            status: "completed",
            model: "gpt-5.5",
            output: [
              {
                id: "message-id",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [{ type: "output_text", text: "ok", annotations: [] }],
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock;

    const adapter = createPrimaryModelAdapter({
      workspaceRoot: process.cwd(),
      selectedProviderId: "openai",
      modelProviders: [],
    });

    await adapter.generateText({ system: "You are concise.", prompt: "hi" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    const body = JSON.parse(String(init.body)) as { store?: unknown; instructions?: unknown };

    expect(body.store).toBe(false);
    expect(body.instructions).toBe("You are concise.");
  });
});
