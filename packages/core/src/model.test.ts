import { describe, expect, it } from "vitest";
import { createPrimaryModelAdapter } from "./model.js";

describe("createPrimaryModelAdapter", () => {
  it("requires a provider", () => {
    expect(() => createPrimaryModelAdapter({ modelProviders: [] })).toThrow(/No model provider/);
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
});
