import type { Session, SessionEvent, SessionEventType, SessionStore } from "@magi/core";

export type DraftSessionEvent = Omit<SessionEvent, "sessionId">;

export type AppendDraftSessionEventInput = {
  type: SessionEventType;
  payload: unknown;
};

export function appendDraftSessionEvent(input: {
  draftEvents: DraftSessionEvent[];
  event: AppendDraftSessionEventInput;
  createId?: () => string;
  now?: () => Date;
}): { draftEvents: DraftSessionEvent[]; event: SessionEvent } {
  const draftEvent = {
    id: input.createId?.() ?? crypto.randomUUID(),
    sequence: input.draftEvents.length + 1,
    type: input.event.type,
    payload: input.event.payload,
    createdAt: (input.now?.() ?? new Date()).toISOString(),
  } satisfies DraftSessionEvent;

  return {
    draftEvents: [...input.draftEvents, draftEvent],
    event: { ...draftEvent, sessionId: "draft" },
  };
}

export function draftEventsToSessionEvents(draftEvents: DraftSessionEvent[]): SessionEvent[] {
  return draftEvents.map((event) => ({ ...event, sessionId: "draft" }));
}

export function persistDraftSession(input: {
  session: Session | undefined;
  store: SessionStore;
  draftEvents: DraftSessionEvent[];
  userMessage: string;
  assistantMessage: string;
  createTitle: (input: { userMessage: string; assistantMessage: string }) => string;
}): { persisted: false } | { persisted: true; session: Session; title: string } {
  if (input.session || input.draftEvents.length === 0) {
    return { persisted: false };
  }

  const title = input.createTitle({
    userMessage: input.userMessage,
    assistantMessage: input.assistantMessage,
  });
  const session = input.store.createSession({ title });

  for (const event of input.draftEvents) {
    input.store.appendEvent({ sessionId: session.id, type: event.type, payload: event.payload });
  }

  return { persisted: true, session, title };
}
