import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSessionStore } from "./session.js";

describe("createSessionStore", () => {
  it("creates a SQLite database and stores sessions", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-session-test-"));
    const databasePath = join(workspaceRoot, ".magi", "magi.db");
    const store = createSessionStore({ workspaceRoot, databasePath });

    try {
      const session = store.createSession({ title: "test session" });

      expect(existsSync(databasePath)).toBe(true);
      expect(session.workspaceRoot).toBe(workspaceRoot);
      expect(session.title).toBe("test session");
    } finally {
      store.close();
    }
  });

  it("appends events with increasing sequence numbers", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-session-test-"));
    const store = createSessionStore({ workspaceRoot });

    try {
      const session = store.createSession();
      const firstEvent = store.appendEvent({
        sessionId: session.id,
        type: "user_message",
        payload: { content: "first" },
      });
      const secondEvent = store.appendEvent({
        sessionId: session.id,
        type: "assistant_message",
        payload: { content: "second" },
      });

      expect(firstEvent.sequence).toBe(1);
      expect(secondEvent.sequence).toBe(2);
      expect(store.listEvents(session.id)).toEqual([firstEvent, secondEvent]);
    } finally {
      store.close();
    }
  });
});
