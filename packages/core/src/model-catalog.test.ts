import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setAuth } from "./auth.js";
import { builtinModelProviders, listEffectiveModelProviders } from "./model-catalog.js";

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
