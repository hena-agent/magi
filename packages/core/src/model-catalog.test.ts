import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setAuth } from "./auth.js";
import {
  builtinModelProviders,
  listEffectiveModelProviders,
  listModelsDevModelProviders,
} from "./model-catalog.js";

describe("model catalog", () => {
  it("includes built-in OpenAI Codex OAuth providers", () => {
    expect(builtinModelProviders.map((provider) => provider.id)).toContain("openai");
    expect(builtinModelProviders.find((provider) => provider.id === "openai")?.model).toBe(
      "gpt-5.5",
    );
  });

  it("lists built-ins with login_required before auth", () => {
    const providers = listEffectiveModelProviders({ configProviders: [] });

    expect(providers.find((provider) => provider.id === "openai")).toMatchObject({
      provider: "openai",
      model: "gpt-5.5",
      source: "builtin",
      authStatus: "login_required",
    });
  });

  it("marks OpenAI built-ins authenticated when OAuth auth exists", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-catalog-"));

    try {
      setAuth({
        workspaceRoot,
        providerId: "openai",
        auth: { type: "oauth", refresh: "r", access: "a", expires: Date.now() + 60_000 },
      });

      expect(
        listEffectiveModelProviders({ configProviders: [], workspaceRoot }).find(
          (provider) => provider.id === "openai",
        ),
      ).toMatchObject({ authStatus: "authenticated" });
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("lets config providers override built-ins by id", () => {
    const providers = listEffectiveModelProviders({
      configProviders: [
        { id: "openai", provider: "openai", model: "gpt-5.5", auth: { type: "oauth" } },
      ],
    });

    expect(providers.find((provider) => provider.id === "openai")?.source).toBe("config");
  });
});

describe("Models.dev model provider projection", () => {
  it("projects known Models.dev providers into model provider settings", () => {
    const providers = listModelsDevModelProviders(modelsDevFixture());

    expect(providers).toContainEqual({
      id: "anthropic",
      provider: "anthropic",
      model: "claude-sonnet",
      apiKeyEnv: "ANTHROPIC_API_KEY",
    });
    expect(providers).toContainEqual({
      id: "google",
      provider: "google",
      model: "gemini-pro",
      apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    });
  });
});

function modelsDevFixture() {
  return {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      models: {
        "claude-haiku": model({ id: "claude-haiku", tool_call: true }),
        "claude-sonnet": model({ id: "claude-sonnet", tool_call: true, reasoning: true }),
      },
    },
    google: {
      id: "google",
      name: "Google",
      env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
      models: {
        "gemini-flash": model({ id: "gemini-flash", tool_call: true }),
        "gemini-pro": model({ id: "gemini-pro", tool_call: true, reasoning: true }),
      },
    },
  };
}

function model(input: { id: string; tool_call: boolean; reasoning?: boolean }) {
  return {
    id: input.id,
    name: input.id,
    release_date: "2026-01-01",
    attachment: false,
    reasoning: input.reasoning ?? false,
    temperature: true,
    tool_call: input.tool_call,
    limit: { context: 1000, output: 1000 },
  };
}
