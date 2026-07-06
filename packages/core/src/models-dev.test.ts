import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadModelsDevCatalog } from "./models-dev.js";

it("loads and caches the Models.dev catalog", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-models-dev-"));
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(fixtureCatalog())));

  try {
    const first = await loadModelsDevCatalog({ workspaceRoot, fetch: fetchMock });
    const second = await loadModelsDevCatalog({ workspaceRoot, fetch: fetchMock });

    expect(first.anthropic?.models["claude-sonnet"]).toMatchObject({
      id: "claude-sonnet",
      tool_call: true,
    });
    expect(second.google?.models.gemini).toMatchObject({ id: "gemini" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

it("falls back to a stale cache when refresh fails", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-models-dev-stale-"));
  const okFetch = vi.fn(async () => new Response(JSON.stringify(fixtureCatalog())));
  const failingFetch = vi.fn(async () => new Response("nope", { status: 503 }));

  try {
    await loadModelsDevCatalog({ workspaceRoot, fetch: okFetch, maxAgeMs: -1 });

    await expect(
      loadModelsDevCatalog({ workspaceRoot, fetch: failingFetch, maxAgeMs: -1 }),
    ).resolves.toMatchObject({ anthropic: { id: "anthropic" } });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

function fixtureCatalog() {
  return {
    anthropic: {
      id: "anthropic",
      name: "Anthropic",
      env: ["ANTHROPIC_API_KEY"],
      npm: "@ai-sdk/anthropic",
      models: {
        "claude-sonnet": {
          id: "claude-sonnet",
          name: "Claude Sonnet",
          family: "claude",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          limit: { context: 200000, output: 8192 },
        },
      },
    },
    google: {
      id: "google",
      name: "Google",
      env: ["GOOGLE_GENERATIVE_AI_API_KEY"],
      npm: "@ai-sdk/google",
      models: {
        gemini: {
          id: "gemini",
          name: "Gemini",
          family: "gemini",
          release_date: "2026-01-01",
          attachment: false,
          reasoning: true,
          temperature: true,
          tool_call: true,
          limit: { context: 1000000, output: 8192 },
        },
      },
    },
  };
}
