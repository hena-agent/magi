import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore } from "@magi/core";
import { expect, it } from "vitest";
import {
  appendDraftSessionEvent,
  createSessionEventJournal,
  type DraftSessionEvent,
  draftEventsToSessionEvents,
  persistDraftSession,
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

it("routes events to the persisted session immediately without a render boundary", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-session-journal-"));
  const store = createSessionStore({ workspaceRoot });
  const journal = createSessionEventJournal({
    store,
    createId: () => "draft-event",
    now: () => new Date("2026-07-01T00:00:00.000Z"),
  });

  try {
    journal.append({ type: "user_message", payload: { content: "First prompt" } });
    journal.append({ type: "assistant_message", payload: { content: "First answer" } });
    const persisted = journal.persistDraft({
      userMessage: "First prompt",
      assistantMessage: "First answer",
      createTitle: () => "One session",
    });
    expect(persisted.persisted).toBe(true);
    if (!persisted.persisted) return;

    const queuedEvent = journal.append({
      type: "user_message",
      payload: { content: "Queued prompt", source: "queued" },
    });
    const secondPersistence = journal.persistDraft({
      userMessage: "Queued prompt",
      assistantMessage: "Queued answer",
      createTitle: () => "Unexpected second session",
    });

    expect(queuedEvent.sessionId).toBe(persisted.session.id);
    expect(secondPersistence).toEqual({ persisted: false });
    expect(store.listSessions({ workspaceRoot })).toHaveLength(1);
    expect(store.listEvents(persisted.session.id).map((event) => event.type)).toEqual([
      "user_message",
      "assistant_message",
      "user_message",
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

it("switches synchronously between persisted and draft event routing", () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-session-journal-"));
  const store = createSessionStore({ workspaceRoot });
  const session = store.createSession({ title: "Existing" });
  const journal = createSessionEventJournal({ store, initialSession: session });

  try {
    expect(journal.append({ type: "summary", payload: { text: "saved" } }).sessionId).toBe(
      session.id,
    );
    journal.resetToDraft();
    expect(journal.append({ type: "summary", payload: { text: "draft" } }).sessionId).toBe("draft");
    expect(journal.getEvents()).toHaveLength(1);

    journal.selectSession(session);
    const resumed = journal.append({ type: "summary", payload: { text: "resumed" } });
    expect(resumed).toMatchObject({ sessionId: session.id, sequence: 2 });
    expect(store.listEvents(session.id)).toHaveLength(2);
  } finally {
    store.close();
  }
});
