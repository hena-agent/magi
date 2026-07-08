import { createSessionStore } from "@magi/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialSession, createSessionStartMessage } from "./tui-session-state.js";

const modelProviders: [] = [];

describe("TUI session state helpers", () => {
  it("creates a draft initial session when startup is not resume", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-session-state-"));
    const store = createSessionStore({ workspaceRoot });

    try {
      const initialSession = createInitialSession(store, {
        workspaceRoot,
        modelProviders,
        session: { startup: "new" },
      });

      expect(initialSession).toEqual({ resumed: false });
      expect(createSessionStartMessage(initialSession).parts[0]).toMatchObject({
        id: "session-start:status",
        text: "Draft session: a session will be saved after the first successful prompt.",
      });
    } finally {
      store.close();
    }
  });

  it("resumes the latest session when configured", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-session-state-"));
    const store = createSessionStore({ workspaceRoot });

    try {
      const session = store.createSession({ title: "Existing work" });
      const initialSession = createInitialSession(store, {
        workspaceRoot,
        modelProviders,
        session: { startup: "resume" },
      });

      expect(initialSession).toMatchObject({ resumed: true, session: { id: session.id } });
      expect(createSessionStartMessage(initialSession).parts[0]).toMatchObject({
        text: `Resumed latest session: ${session.id} (Existing work)`,
      });
    } finally {
      store.close();
    }
  });
});
