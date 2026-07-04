import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createSessionStore } from "./session.js";

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

it("lists, finds, updates, and resumes the latest session", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-session-test-"));
  const otherWorkspaceRoot = mkdtempSync(join(tmpdir(), "magi-session-test-other-"));
  const databasePath = join(workspaceRoot, ".magi", "magi.db");
  const store = createSessionStore({ workspaceRoot, databasePath });
  const otherStore = createSessionStore({ workspaceRoot: otherWorkspaceRoot, databasePath });

  try {
    const firstSession = store.createSession({ title: "first" });
    const secondSession = store.createSession({ title: "second" });
    const otherSession = otherStore.createSession({ title: "other" });
    store.appendEvent({
      sessionId: firstSession.id,
      type: "user_message",
      payload: { content: "bump first" },
    });

    expect(store.getSession(secondSession.id)?.title).toBe("second");
    expect(store.getSession("missing")).toBeUndefined();
    expect(store.getLatestSession({ workspaceRoot })?.id).toBe(firstSession.id);
    expect(store.getLatestSession({ workspaceRoot: otherWorkspaceRoot })?.id).toBe(otherSession.id);
    expect(store.listSessions({ workspaceRoot, limit: 1 })).toHaveLength(1);

    const updatedSession = store.updateSession({ sessionId: secondSession.id, title: "renamed" });

    expect(updatedSession.title).toBe("renamed");
    expect(store.getLatestSession({ workspaceRoot })?.id).toBe(secondSession.id);
  } finally {
    otherStore.close();
    store.close();
  }
});
