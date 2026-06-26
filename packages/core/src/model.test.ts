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
});
