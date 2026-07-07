import { describe, expect, it } from "vitest";
import {
  inferMagiEngineFamily,
  selectMagiEnginePool,
  selectMagiInitiatingEngine,
} from "./engine-selection.js";

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

describe("MAGI initiating engine selection", () => {
  it("selects among ready engines with deterministic weighted roulette", () => {
    const pool = selectMagiEnginePool({
      env: { ANTHROPIC_API_KEY: "anthropic-key", GOOGLE_GENERATIVE_AI_API_KEY: "google-key" },
      providers: [
        { id: "openai", provider: "openai", model: "gpt-5.5", auth: { type: "oauth" } },
        { id: "anthropic", provider: "anthropic", model: "claude-sonnet" },
        { id: "google", provider: "google", model: "gemini-pro" },
      ],
    });

    expect(
      selectMagiInitiatingEngine({
        engines: pool.selectedEngines,
        weights: { openai: 1, anthropic: 2, google: 7 },
        random: () => 0.05,
      }).engine.providerId,
    ).toBe("openai");
    expect(
      selectMagiInitiatingEngine({
        engines: pool.selectedEngines,
        weights: { openai: 1, anthropic: 2, google: 7 },
        random: () => 0.2,
      }).engine.providerId,
    ).toBe("anthropic");
    expect(
      selectMagiInitiatingEngine({
        engines: pool.selectedEngines,
        weights: { openai: 1, anthropic: 2, google: 7 },
        random: () => 0.95,
      }).engine.providerId,
    ).toBe("google");
  });

  it("uses equal default weights and ignores unready engines", () => {
    const result = selectMagiInitiatingEngine({
      engines: [
        {
          family: "openai",
          providerId: "openai",
          provider: "openai",
          model: "gpt-5.5",
          ready: true,
          configured: false,
        },
        {
          family: "anthropic",
          providerId: "anthropic",
          provider: "anthropic",
          model: "claude-sonnet",
          ready: false,
          configured: false,
          missingEnv: "ANTHROPIC_API_KEY",
        },
        {
          family: "google",
          providerId: "google",
          provider: "google",
          model: "gemini-pro",
          ready: true,
          configured: false,
        },
      ],
      random: () => 0.75,
    });

    expect(result.engine.providerId).toBe("google");
    expect(result.totalWeight).toBe(2);
    expect(result.weights).toEqual({ openai: 1, google: 1 });
  });

  it("keeps a minimum weight floor for invalid or depleted weights", () => {
    const result = selectMagiInitiatingEngine({
      engines: [
        {
          family: "openai",
          providerId: "openai",
          provider: "openai",
          model: "gpt-5.5",
          ready: true,
          configured: false,
        },
        {
          family: "anthropic",
          providerId: "anthropic",
          provider: "anthropic",
          model: "claude-sonnet",
          ready: true,
          configured: false,
        },
      ],
      weights: { openai: 0, anthropic: Number.NaN },
      random: () => 0,
    });

    expect(result.engine.providerId).toBe("openai");
    expect(result.weights).toEqual({ openai: 0.01, anthropic: 0.01 });
  });

  it("requires at least one ready engine", () => {
    expect(() => selectMagiInitiatingEngine({ engines: [] })).toThrow(
      "MAGI initiator selection requires at least one ready engine.",
    );
  });
});
