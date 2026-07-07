import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { asc, desc, eq, max } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
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
  | "agent_step_started"
  | "assistant_started"
  | "assistant_status"
  | "assistant_stream"
  | "agent_step_ended"
  | "agent_tool_skipped"
  | "provider_error"
  | "interruption"
  | "magi_decision_trail"
  | "tool_call"
  | "tool_result"
  | "tool_settlement"
  | "permission_decision"
  | "proposed_patch"
  | "verification_result"
  | "context_summary"
  | "queued_user_input"
  | "agent_switch"
  | "model_switch"
  | "todo_update"
  | "task_update"
  | "plan_exit"
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
  getSession(sessionId: string): Session | undefined;
  getLatestSession(input?: { workspaceRoot?: string }): Session | undefined;
  listSessions(input?: { workspaceRoot?: string; limit?: number }): Session[];
  updateSession(input: { sessionId: string; title?: string }): Session;
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
  let lastTimestampMs = 0;
  migrate(db, { migrationsFolder: options.migrationsFolder ?? defaultMigrationsFolder });

  return new SqliteSessionStore({
    db,
    sqlite,
    workspaceRoot: options.workspaceRoot,
    nextTimestamp,
  });

  function nextTimestamp(): string {
    const now = Date.now();
    lastTimestampMs = Math.max(now, lastTimestampMs + 1);

    return new Date(lastTimestampMs).toISOString();
  }
}

type SessionDatabase = ReturnType<typeof drizzle>;

class SqliteSessionStore implements SessionStore {
  readonly #db: SessionDatabase;
  readonly #sqlite: Database.Database;
  readonly #workspaceRoot: string;
  readonly #nextTimestamp: () => string;

  constructor(input: {
    db: SessionDatabase;
    sqlite: Database.Database;
    workspaceRoot: string;
    nextTimestamp: () => string;
  }) {
    this.#db = input.db;
    this.#sqlite = input.sqlite;
    this.#workspaceRoot = input.workspaceRoot;
    this.#nextTimestamp = input.nextTimestamp;
  }

  createSession(input: { title?: string } = {}): Session {
    const timestamp = this.#nextTimestamp();
    const session = createSessionRecord(this.#workspaceRoot, timestamp, input.title);

    this.#db.insert(sessions).values(sessionToRow(session)).run();

    return session;
  }

  getSession(sessionId: string): Session | undefined {
    const [row] = this.#db.select().from(sessions).where(eq(sessions.id, sessionId)).all();

    return row === undefined ? undefined : sessionFromRow(row);
  }

  getLatestSession(input: { workspaceRoot?: string } = {}): Session | undefined {
    const [session] = this.listSessions({ workspaceRoot: input.workspaceRoot, limit: 1 });

    return session;
  }

  listSessions(input: { workspaceRoot?: string; limit?: number } = {}): Session[] {
    const limit = input.limit ?? 20;
    const rows =
      input.workspaceRoot === undefined
        ? this.#db.select().from(sessions).orderBy(desc(sessions.updatedAt)).limit(limit).all()
        : this.#db
            .select()
            .from(sessions)
            .where(eq(sessions.workspaceRoot, input.workspaceRoot))
            .orderBy(desc(sessions.updatedAt))
            .limit(limit)
            .all();

    return rows.map(sessionFromRow);
  }

  updateSession(input: { sessionId: string; title?: string }): Session {
    this.#db
      .update(sessions)
      .set({
        ...(input.title === undefined ? {} : { title: input.title }),
        updatedAt: this.#nextTimestamp(),
      })
      .where(eq(sessions.id, input.sessionId))
      .run();

    const session = this.getSession(input.sessionId);

    if (!session) throw new Error(`Session not found: ${input.sessionId}`);

    return session;
  }

  appendEvent(input: {
    sessionId: string;
    type: SessionEventType;
    payload: unknown;
  }): SessionEvent {
    const timestamp = this.#nextTimestamp();
    const event = createSessionEventRecord(
      input,
      this.#getNextEventSequence(input.sessionId),
      timestamp,
    );

    this.#db.insert(sessionEvents).values(eventToRow(event)).run();
    this.#db
      .update(sessions)
      .set({ updatedAt: timestamp })
      .where(eq(sessions.id, input.sessionId))
      .run();

    return event;
  }

  listEvents(sessionId: string): SessionEvent[] {
    return this.#db
      .select()
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .orderBy(asc(sessionEvents.sequence))
      .all()
      .map(eventFromRow);
  }

  close(): void {
    this.#sqlite.close();
  }

  #getNextEventSequence(sessionId: string): number {
    const [row] = this.#db
      .select({ sequence: max(sessionEvents.sequence) })
      .from(sessionEvents)
      .where(eq(sessionEvents.sessionId, sessionId))
      .all();

    return (row?.sequence ?? 0) + 1;
  }
}

function createSessionRecord(workspaceRoot: string, timestamp: string, title?: string): Session {
  return {
    id: crypto.randomUUID(),
    workspaceRoot,
    ...(title === undefined ? {} : { title }),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sessionToRow(session: Session): typeof sessions.$inferInsert {
  return {
    id: session.id,
    workspaceRoot: session.workspaceRoot,
    title: session.title ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

function createSessionEventRecord(
  input: { sessionId: string; type: SessionEventType; payload: unknown },
  sequence: number,
  timestamp: string,
): SessionEvent {
  return {
    id: crypto.randomUUID(),
    sessionId: input.sessionId,
    sequence,
    type: input.type,
    payload: input.payload,
    createdAt: timestamp,
  };
}

function eventToRow(event: SessionEvent): typeof sessionEvents.$inferInsert {
  return {
    id: event.id,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type,
    payloadJson: JSON.stringify(event.payload),
    createdAt: event.createdAt,
  };
}

function eventFromRow(event: typeof sessionEvents.$inferSelect): SessionEvent {
  return {
    id: event.id,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type as SessionEventType,
    payload: JSON.parse(event.payloadJson) as unknown,
    createdAt: event.createdAt,
  };
}

function sessionFromRow(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    workspaceRoot: row.workspaceRoot,
    ...(row.title === null ? {} : { title: row.title }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
