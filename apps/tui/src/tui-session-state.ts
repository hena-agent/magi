import type { loadConfig } from "@magi/config";
import {
  getDefaultModelSelection,
  getEffectiveModelProviderSummaries,
  getLatestModelSelection,
  type Session,
  type SessionEvent,
  type SessionStore,
} from "@magi/core";
import type { TranscriptMessage } from "./transcript-types.js";

type TuiSessionConfig = Pick<
  ReturnType<typeof loadConfig>,
  "modelProviders" | "session" | "workspaceRoot"
>;

export type InitialSessionState = {
  session?: Session;
  resumed: boolean;
};

export function createInitialSession(
  store: SessionStore,
  config: TuiSessionConfig,
): InitialSessionState {
  if (config.session.startup === "resume") {
    const latestSession = store.getLatestSession({ workspaceRoot: config.workspaceRoot });

    if (latestSession) {
      return { session: latestSession, resumed: true };
    }
  }

  return { resumed: false };
}

export function getInitialModelProviderId(
  store: SessionStore,
  initialSession: InitialSessionState,
  config: TuiSessionConfig,
): string | undefined {
  const events = initialSession.session ? store.listEvents(initialSession.session.id) : [];
  return getRestoredModelProviderId(events, config);
}

export function getRestoredModelProviderId(
  events: SessionEvent[],
  config: Pick<TuiSessionConfig, "modelProviders" | "workspaceRoot">,
): string | undefined {
  const modelProviders = getEffectiveModelProviderSummaries({
    configProviders: config.modelProviders,
    workspaceRoot: config.workspaceRoot,
  });
  const selection = getLatestModelSelection({
    events,
    modelProviders,
  });

  return modelProviders.some((provider) => provider.id === selection?.providerId)
    ? selection?.providerId
    : getDefaultModelSelection({ modelProviders })?.providerId;
}

export function getLatestAgentId(events: SessionEvent[], fallback = "build"): string {
  let agentId = fallback;
  for (const event of events) {
    if (event.type !== "agent_switch") continue;
    const payload = event.payload as { agentId?: unknown };
    if (typeof payload.agentId === "string") agentId = payload.agentId;
  }
  return agentId;
}

export function createSystemMessage(
  content: string,
  id: string = crypto.randomUUID(),
): TranscriptMessage {
  return {
    id,
    role: "system",
    createdAt: Date.now(),
    parts: [{ id: `${id}:status`, type: "status", text: content, tone: "muted" }],
  };
}

export function createSessionStartMessage(initialSession: InitialSessionState): TranscriptMessage {
  return createSystemMessage(
    initialSession.session === undefined
      ? "Draft session: a session will be saved after the first successful prompt."
      : `${initialSession.resumed ? "Resumed latest session" : "Started new session"}: ${initialSession.session.id}${initialSession.session.title ? ` (${initialSession.session.title})` : ""}`,
    "session-start",
  );
}
