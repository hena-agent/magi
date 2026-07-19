import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createPrimaryModelAdapter } from "./model.js";
import { RAW_MODEL_LOGGING_ENV } from "./openai-codex-oauth-fetch.js";

const originalFetch = globalThis.fetch;
const workspaces: string[] = [];

afterEach(async () => {
  globalThis.fetch = originalFetch;
  delete process.env.MAGI_AUTH_CONTENT;
  delete process.env[RAW_MODEL_LOGGING_ENV];
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true })));
  vi.restoreAllMocks();
});

it("does not create the raw model debug directory by default", async () => {
  const workspaceRoot = await createWorkspace();
  delete process.env[RAW_MODEL_LOGGING_ENV];
  installOAuthAuth();
  installSseFetch();

  await runOAuthStep(workspaceRoot);

  await expect(access(join(workspaceRoot, ".magi", "debug"))).rejects.toThrow();
});

it("logs raw OAuth requests and model events only with explicit opt-in", async () => {
  const workspaceRoot = await createWorkspace();
  process.env[RAW_MODEL_LOGGING_ENV] = "1";
  installOAuthAuth();
  installSseFetch();

  await runOAuthStep(workspaceRoot);

  const contents = await readFile(
    join(workspaceRoot, ".magi", "debug", "model-raw.ndjson"),
    "utf8",
  );
  const records = contents
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { phase: string });

  expect(records.map((record) => record.phase)).toEqual([
    "oauth-request",
    "oauth-raw-event",
    "oauth-raw-event",
    "oauth-step-result",
  ]);
  expect(contents).not.toContain("access-token");
  expect(contents.toLowerCase()).not.toContain("authorization");
});

async function createWorkspace(): Promise<string> {
  const workspace = await mkdtemp(join(tmpdir(), "magi-raw-model-logging-"));
  workspaces.push(workspace);
  return workspace;
}

function installOAuthAuth(): void {
  process.env.MAGI_AUTH_CONTENT = JSON.stringify({
    openai: {
      type: "oauth",
      refresh: "refresh-token",
      access: "access-token",
      expires: Date.now() + 60_000,
    },
  });
}

function installSseFetch(): void {
  globalThis.fetch = vi.fn(
    async () =>
      new Response(
        [
          { type: "response.output_text.delta", delta: "safe response" },
          { type: "response.completed", response: { id: "response-id" } },
        ]
          .map((event) => `data: ${JSON.stringify(event)}\n\n`)
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
}

async function runOAuthStep(workspaceRoot: string): Promise<void> {
  const adapter = createPrimaryModelAdapter({
    workspaceRoot,
    selectedProviderId: "openai",
    modelProviders: [],
  });

  await adapter.generateStep?.({
    messages: [{ role: "user", content: "sensitive request" }],
    tools: [],
  });
}
