import Database from "better-sqlite3";
import { asc, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sessionEvents, sessions } from "./db/schema.js";

export type Session = {
  id: string;
  workspaceRoot: string;
  title?: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionEventType =
  | "user_message"
  | "assistant_message"
  | "magi_decision_trail"
  | "tool_call"
  | "tool_result"
  | "permission_decision"
  | "proposed_patch"
  | "verification_result"
  | "summary";

export type SessionEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  type: SessionEventType;
  payload: unknown;
  createdAt: string;
};

type CreateSessionStoreOptions = {
  workspaceRoot: string;
  databasePath?: string;
  migrationsFolder?: string;
};

export type SessionStore = {
  createSession(input?: { title?: string }): Session;
  appendEvent(input: { sessionId: string; type: SessionEventType; payload: unknown }): SessionEvent;
  listEvents(sessionId: string): SessionEvent[];
  close(): void;
};

const defaultMigrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export function createSessionStore(options: CreateSessionStoreOptions): SessionStore {
  const databasePath = options.databasePath ?? join(options.workspaceRoot, ".magi", "magi.db");
  mkdirSync(dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("foreign_keys = ON");

  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder });

  return {
    createSession(input = {}) {
      const timestamp = new Date().toISOString();
      const session = {
        id: crypto.randomUUID(),
        workspaceRoot: options.workspaceRoot,
        ...(input.title === undefined ? {} : { title: input.title }),
        createdAt: timestamp,
        updatedAt: timestamp,
      } satisfies Session;

      db.insert(sessions)
        .values({
          id: session.id,
          workspaceRoot: session.workspaceRoot,
          title: session.title ?? null,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
        })
        .run();

      return session;
    },
    appendEvent(input) {
      const timestamp = new Date().toISOString();
      const nextSequence = getNextEventSequence(input.sessionId);
      const event = {
        id: crypto.randomUUID(),
        sessionId: input.sessionId,
        sequence: nextSequence,
        type: input.type,
        payload: input.payload,
        createdAt: timestamp,
      } satisfies SessionEvent;

      db.insert(sessionEvents)
        .values({
          id: event.id,
          sessionId: event.sessionId,
          sequence: event.sequence,
          type: event.type,
          payloadJson: JSON.stringify(event.payload),
          createdAt: event.createdAt,
        })
        .run();

      db.update(sessions)
        .set({ updatedAt: timestamp })
        .where(eq(sessions.id, input.sessionId))
        .run();

      return event;
    },
    listEvents(sessionId) {
      return db
        .select()
        .from(sessionEvents)
        .where(eq(sessionEvents.sessionId, sessionId))
        .orderBy(asc(sessionEvents.sequence))
        .all()
        .map((event) => ({
          id: event.id,
          sessionId: event.sessionId,
          sequence: event.sequence,
          type: event.type as SessionEventType,
          payload: JSON.parse(event.payloadJson) as unknown,
          createdAt: event.createdAt,
        }));
    },
    close() {
      sqlite.close();
    },
  };

  function getNextEventSequence(sessionId: string): number {
    const [row] = db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .all();

    return (row?.sequence ?? 0) + 1;
  }
}
