import { createSessionStore } from "@magi/core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  appendDraftSessionEvent,
  draftEventsToSessionEvents,
  persistDraftSession,
  type DraftSessionEvent,
} from "./draft-session.js";

it("keeps draft events in memory until first successful persistence", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-draft-session-"));
  const store = createSessionStore({ workspaceRoot });

  try {
    let draftEvents: DraftSessionEvent[] = [];
    const first = appendDraftSessionEvent({
      draftEvents,
      event: { type: "user_message", payload: { content: "Build this" } },
      createId: () => "draft-1",
      now: () => new Date("2026-07-01T00:00:00.000Z"),
    });
    draftEvents = first.draftEvents;
    const second = appendDraftSessionEvent({
      draftEvents,
      event: { type: "assistant_message", payload: { content: "Implemented it" } },
      createId: () => "draft-2",
      now: () => new Date("2026-07-01T00:00:01.000Z"),
    });
    draftEvents = second.draftEvents;

    expect(store.listSessions({ workspaceRoot })).toEqual([]);
    expect(first.event).toMatchObject({ id: "draft-1", sessionId: "draft", sequence: 1 });
    expect(second.event).toMatchObject({ id: "draft-2", sessionId: "draft", sequence: 2 });
    expect(draftEventsToSessionEvents(draftEvents).map((event) => event.sessionId)).toEqual([
      "draft",
      "draft",
    ]);

    const persisted = persistDraftSession({
      session: undefined,
      store,
      draftEvents,
      userMessage: "Build this",
      assistantMessage: "Implemented it",
      createTitle: () => "Draft title",
    });

    expect(persisted.persisted).toBe(true);
    if (!persisted.persisted) return;
    expect(persisted.title).toBe("Draft title");
    expect(store.listSessions({ workspaceRoot })).toHaveLength(1);
    expect(store.listEvents(persisted.session.id).map((event) => event.sequence)).toEqual([1, 2]);
    expect(store.listEvents(persisted.session.id).map((event) => event.type)).toEqual([
      "user_message",
      "assistant_message",
    ]);
  } finally {
    store.close();
  }
});

it("does not create another session when a saved session already exists", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-draft-session-"));
  const store = createSessionStore({ workspaceRoot });

  try {
    const session = store.createSession({ title: "Existing" });
    const result = persistDraftSession({
      session,
      store,
      draftEvents: [
        {
          id: "draft-1",
          sequence: 1,
          type: "user_message",
          payload: { content: "ignored" },
          createdAt: new Date("2026-07-01T00:00:00.000Z").toISOString(),
        },
      ],
      userMessage: "Build this",
      assistantMessage: "Implemented it",
      createTitle: () => "Should not be used",
    });

    expect(result).toEqual({ persisted: false });
    expect(store.listSessions({ workspaceRoot })).toHaveLength(1);
    expect(store.listEvents(session.id)).toEqual([]);
  } finally {
    store.close();
  }
});
