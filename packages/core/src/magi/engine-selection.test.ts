import { describe, expect, it } from "vitest";
import { inferMagiEngineFamily, selectMagiEnginePool } from "./engine-selection.js";

describe("MAGI engine selection", () => {
  it("infers engine families from providers and models", () => {
    expect(inferMagiEngineFamily({ id: "anthropic", provider: "anthropic", model: "x" })).toBe(
      "anthropic",
    );
    expect(inferMagiEngineFamily({ id: "google", provider: "google", model: "x" })).toBe("google");
    expect(inferMagiEngineFamily({ id: "openai", provider: "openai", model: "gpt-5" })).toBe(
      "openai",
    );
    expect(inferMagiEngineFamily({ id: "qwen", provider: "custom", model: "qwen-coder" })).toBe(
      "qwen",
    );
  });
});

describe("MAGI engine pool selection", () => {
  it("selects a diverse ready pool with a default minimum of two engines", () => {
    const result = selectMagiEnginePool({
      env: {
        ANTHROPIC_API_KEY: "anthropic-key",
        GOOGLE_GENERATIVE_AI_API_KEY: "google-key",
      },
      providers: [
        { id: "openai", provider: "openai", model: "gpt-5.5", auth: { type: "oauth" } },
        { id: "anthropic", provider: "anthropic", model: "claude-sonnet" },
        { id: "google", provider: "google", model: "gemini-pro" },
      ],
    });

    expect(result.ready).toBe(true);
    expect(result.requiredCount).toBe(2);
    expect(result.selectedEngines.map((engine) => engine.providerId)).toEqual([
      "openai",
      "anthropic",
      "google",
    ]);
  });

  it("supports configured two-engine MAGI", () => {
    const result = selectMagiEnginePool({
      env: { ANTHROPIC_API_KEY: "anthropic-key" },
      selection: { providerIds: ["openai", "anthropic"], minEngines: 2, maxEngines: 2 },
      providers: [
        { id: "openai", provider: "openai", model: "gpt-5.5", auth: { type: "oauth" } },
        { id: "anthropic", provider: "anthropic", model: "claude-sonnet" },
        { id: "google", provider: "google", model: "gemini-pro" },
      ],
    });

    expect(result.ready).toBe(true);
    expect(result.selectedEngines.map((engine) => engine.providerId)).toEqual([
      "openai",
      "anthropic",
    ]);
  });

  it("reports unready configured engines", () => {
    const result = selectMagiEnginePool({
      env: {},
      selection: { providerIds: ["openai", "anthropic"], minEngines: 2 },
      providers: [
        { id: "openai", provider: "openai", model: "gpt-5.5", auth: { type: "oauth" } },
        { id: "anthropic", provider: "anthropic", model: "claude-sonnet" },
      ],
    });

    expect(result.ready).toBe(false);
    expect(result.unreadyConfiguredEngines).toEqual([
      expect.objectContaining({ providerId: "anthropic", missingEnv: "ANTHROPIC_API_KEY" }),
    ]);
  });
});
