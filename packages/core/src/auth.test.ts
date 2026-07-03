import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getAuth, getAuthFilePath, loadAuthStore, removeAuth, setAuth } from "./auth.js";

describe("auth store", () => {
  it("stores OpenCode-compatible OAuth auth with 0600 permissions", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-auth-"));

    try {
      setAuth({
        workspaceRoot,
        providerId: "openai/",
        auth: {
          type: "oauth",
          refresh: "refresh-token",
          access: "access-token",
          expires: 123,
          accountId: "account-id",
        },
      });

      expect(getAuth({ workspaceRoot, providerId: "openai" })).toEqual({
        type: "oauth",
        refresh: "refresh-token",
        access: "access-token",
        expires: 123,
        accountId: "account-id",
      });
      expect(statSync(getAuthFilePath(workspaceRoot)).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads MAGI_AUTH_CONTENT before the auth file", () => {
    process.env.MAGI_AUTH_CONTENT = JSON.stringify({
      openai: { type: "oauth", refresh: "r", access: "a", expires: 1 },
    });

    try {
      expect(loadAuthStore({ workspaceRoot: "/unused" })).toEqual({
        openai: { type: "oauth", refresh: "r", access: "a", expires: 1 },
      });
    } finally {
      delete process.env.MAGI_AUTH_CONTENT;
    }
  });

  it("removes stored auth", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-auth-remove-"));

    try {
      setAuth({
        workspaceRoot,
        providerId: "openai",
        auth: { type: "oauth", refresh: "r", access: "a", expires: 1 },
      });
      removeAuth({ workspaceRoot, providerId: "openai" });

      expect(getAuth({ workspaceRoot, providerId: "openai" })).toBeUndefined();
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});
