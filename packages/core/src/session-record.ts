import type { sessionEvents, sessions } from "./db/schema.js";
import type { Session, SessionEvent, SessionEventType } from "./session.js";

export function createSessionRecord(input: {
  workspaceRoot: string;
  project: string | undefined;
  directory: string | undefined;
  timestamp: string;
  title?: string;
}): Session {
  return {
    id: crypto.randomUUID(),
    workspaceRoot: input.workspaceRoot,
    ...(input.project === undefined ? {} : { project: input.project }),
    ...(input.directory === undefined ? {} : { directory: input.directory }),
    ...(input.title === undefined ? {} : { title: input.title }),
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
  };
}

export function sessionToRow(session: Session): typeof sessions.$inferInsert {
  return {
    id: session.id,
    workspaceRoot: session.workspaceRoot,
    project: session.project ?? null,
    directory: session.directory ?? null,
    title: session.title ?? null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function sessionFromRow(row: typeof sessions.$inferSelect): Session {
  return {
    id: row.id,
    workspaceRoot: row.workspaceRoot,
    ...(row.project === null ? {} : { project: row.project }),
    ...(row.directory === null ? {} : { directory: row.directory }),
    ...(row.title === null ? {} : { title: row.title }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function createSessionEventRecord(
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

export function eventToRow(event: SessionEvent): typeof sessionEvents.$inferInsert {
  return {
    id: event.id,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type,
    payloadJson: JSON.stringify(event.payload),
    createdAt: event.createdAt,
  };
}

export function eventFromRow(event: typeof sessionEvents.$inferSelect): SessionEvent {
  return {
    id: event.id,
    sessionId: event.sessionId,
    sequence: event.sequence,
    type: event.type as SessionEventType,
    payload: JSON.parse(event.payloadJson) as unknown,
    createdAt: event.createdAt,
  };
}
