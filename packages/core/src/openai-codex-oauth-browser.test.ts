import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loginOpenAICodexBrowser } from "./openai-codex-oauth-browser.js";
import { OPENAI_CODEX_OAUTH_PORT } from "./openai-codex-oauth-constants.js";
import { startOAuthServer, stopOAuthServer } from "./openai-codex-oauth-server.js";

afterEach(() => stopOAuthServer());

it("closes the callback server when opening the authorization URL fails", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-oauth-browser-"));

  try {
    await expect(
      loginOpenAICodexBrowser({
        workspaceRoot,
        openUrl() {
          throw new Error("browser unavailable");
        },
      }),
    ).rejects.toThrow("browser unavailable");
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(startOAuthServer()).resolves.toMatchObject({
      redirectUri: expect.stringContaining("/auth/callback"),
    });
  } finally {
    rmSync(workspaceRoot, { recursive: true, force: true });
  }
});

it("clears a failed callback server so a later bind can retry", async () => {
  const blocker = createServer();
  await new Promise<void>((resolve) => blocker.listen(OPENAI_CODEX_OAUTH_PORT, resolve));

  try {
    await expect(startOAuthServer()).rejects.toMatchObject({ code: "EADDRINUSE" });
  } finally {
    await new Promise<void>((resolve, reject) =>
      blocker.close((error) => (error ? reject(error) : resolve())),
    );
  }

  await expect(startOAuthServer()).resolves.toMatchObject({ port: OPENAI_CODEX_OAUTH_PORT });
});
