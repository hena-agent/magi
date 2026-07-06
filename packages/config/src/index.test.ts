import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadConfig } from "./index.js";

it("returns defaults when no config file exists", () => {
  const workspaceRoot = createWorkspace();
  const config = loadConfig({ cwd: workspaceRoot });

  expect(config.workspaceRoot).toBe(workspaceRoot);
  expect(config.modelProviders).toEqual([]);
  expect(config.permissions).toEqual({
    read: "allow",
    write: "prompt",
    shell: "prompt",
    network: "prompt",
  });
  expect(config.verificationCommands).toEqual([
    "pnpm typecheck",
    "pnpm test",
    "pnpm lint",
    "pnpm knip",
  ]);
  expect(config.agent).toEqual({ maxIterations: 30 });
  expect(config.session).toEqual({ startup: "new" });
  expect(config.magi).toEqual({
    selection: { minEngines: 2, maxEngines: 3, preferFamilyDiversity: true },
  });
});

it("loads model providers, permissions, and verification commands", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({
      modelProviders: [
        {
          id: "primary",
          provider: "openai",
          model: "gpt-4.1-mini",
          apiKeyEnv: "OPENAI_API_KEY",
        },
      ],
      permissions: {
        shell: "deny",
        write: "allow",
      },
      verificationCommands: ["pnpm test"],
      agent: { maxIterations: 42 },
      session: { startup: "resume" },
      magi: {
        selection: {
          providerIds: ["openai", "anthropic"],
          minEngines: 2,
          maxEngines: 2,
          preferFamilyDiversity: false,
        },
      },
    }),
  );

  const config = loadConfig({ cwd: join(workspaceRoot, "packages") });

  expect(config.modelProviders).toEqual([
    {
      id: "primary",
      provider: "openai",
      model: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
    },
  ]);
  expect(config.permissions).toEqual({
    read: "allow",
    write: "allow",
    shell: "deny",
    network: "prompt",
  });
  expect(config.verificationCommands).toEqual(["pnpm test"]);
  expect(config.agent).toEqual({ maxIterations: 42 });
  expect(config.session).toEqual({ startup: "resume" });
  expect(config.magi).toEqual({
    selection: {
      providerIds: ["openai", "anthropic"],
      minEngines: 2,
      maxEngines: 2,
      preferFamilyDiversity: false,
    },
  });
});

it("accepts DeepSeek provider config", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({
      modelProviders: [
        {
          id: "primary",
          provider: "deepseek",
          model: "deepseek-v4-pro",
          apiKeyEnv: "DEEPSEEK_API_KEY",
        },
      ],
    }),
  );

  expect(loadConfig({ cwd: workspaceRoot }).modelProviders).toEqual([
    {
      id: "primary",
      provider: "deepseek",
      model: "deepseek-v4-pro",
      apiKeyEnv: "DEEPSEEK_API_KEY",
    },
  ]);
});

it("accepts OpenAI OAuth provider config without apiKeyEnv", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({
      modelProviders: [
        {
          id: "openai",
          provider: "openai",
          model: "gpt-5.5",
          auth: { type: "oauth" },
        },
      ],
    }),
  );

  expect(loadConfig({ cwd: workspaceRoot }).modelProviders).toEqual([
    {
      id: "openai",
      provider: "openai",
      model: "gpt-5.5",
      auth: { type: "oauth" },
    },
  ]);
});

it("rejects OAuth for non-OpenAI providers", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({
      modelProviders: [
        {
          id: "custom",
          provider: "custom",
          model: "model",
          auth: { type: "oauth" },
        },
      ],
    }),
  );

  expect(() => loadConfig({ cwd: workspaceRoot })).toThrow(/oauth is only supported for openai/);
});

it("loads .magi/config.json", () => {
  const workspaceRoot = createWorkspace();
  mkdirSync(join(workspaceRoot, ".magi"));
  writeFileSync(
    join(workspaceRoot, ".magi", "config.json"),
    JSON.stringify({ verificationCommands: ["pnpm check"] }),
  );

  expect(loadConfig({ cwd: workspaceRoot }).verificationCommands).toEqual(["pnpm check"]);
});

it("rejects invalid config values", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({ permissions: { shell: "always" } }),
  );

  expect(() => loadConfig({ cwd: workspaceRoot })).toThrow(/permissions\.shell/);
});

it("rejects invalid agent config values", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({ agent: { maxIterations: 0 } }),
  );

  expect(() => loadConfig({ cwd: workspaceRoot })).toThrow(/agent\.maxIterations/);
});

it("rejects invalid session config values", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({ session: { startup: "latest" } }),
  );

  expect(() => loadConfig({ cwd: workspaceRoot })).toThrow(/session\.startup/);
});

it("rejects invalid MAGI selection values", () => {
  const workspaceRoot = createWorkspace();
  writeFileSync(
    join(workspaceRoot, "magi.config.json"),
    JSON.stringify({ magi: { selection: { minEngines: 3, maxEngines: 2 } } }),
  );

  expect(() => loadConfig({ cwd: workspaceRoot })).toThrow(/minEngines must be <= maxEngines/);
});

function createWorkspace(): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-config-test-"));
  mkdirSync(join(workspaceRoot, "packages"));
  writeFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");

  return workspaceRoot;
}
