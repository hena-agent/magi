import { createSessionStore } from "@magi/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createOpenTuiSessionBoot } from "./opentui-session-boot.js";

const modelProviders: [] = [];

describe("createOpenTuiSessionBoot", () => {
  it("opens the session store and reads initial session state", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-opentui-session-boot-"));
    const boot = createOpenTuiSessionBoot({
      loadConfig: () => ({ workspaceRoot, modelProviders, session: { startup: "resume" } }),
    });

    try {
      expect(boot.sessionStore).toBeDefined();
      expect(boot.sessionStoreError).toBeUndefined();
      expect(boot.initialSession).toEqual({ resumed: false });
    } finally {
      boot.sessionStore?.close();
    }
  });

  it("falls back to draft state when the session store cannot open", () => {
    const boot = createOpenTuiSessionBoot({
      loadConfig: () => ({
        workspaceRoot: "/tmp/magi-opentui-session-boot-fallback",
        modelProviders,
        session: { startup: "resume" },
      }),
      createSessionStore: () => {
        throw new Error("store unavailable");
      },
    });

    expect(boot).toEqual({
      initialSession: { resumed: false },
      sessionStore: undefined,
      sessionStoreError: "store unavailable",
    });
  });

  it("supports injected session stores", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-opentui-session-boot-"));
    const store = createSessionStore({ workspaceRoot });

    try {
      const session = store.createSession({ title: "Resume me" });
      const boot = createOpenTuiSessionBoot({
        loadConfig: () => ({ workspaceRoot, modelProviders, session: { startup: "resume" } }),
        createSessionStore: () => store,
      });

      expect(boot.sessionStore).toBe(store);
      expect(boot.initialSession).toMatchObject({ resumed: true, session: { id: session.id } });
    } finally {
      store.close();
    }
  });
});
