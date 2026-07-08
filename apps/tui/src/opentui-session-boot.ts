import { loadConfig } from "@magi/config";
import { createSessionStore, type SessionStore } from "@magi/core";
import { createInitialSession, type InitialSessionState } from "./tui-session-state.js";

type OpenTuiSessionConfig = Parameters<typeof createInitialSession>[1];

export type OpenTuiSessionBoot = {
  initialSession: InitialSessionState;
  sessionStore: SessionStore | undefined;
  sessionStoreError: string | undefined;
};

type OpenTuiSessionBootDependencies = {
  loadConfig?: () => OpenTuiSessionConfig;
  createSessionStore?: (input: { workspaceRoot: string }) => SessionStore;
};

export function createOpenTuiSessionBoot(
  dependencies: OpenTuiSessionBootDependencies = {},
): OpenTuiSessionBoot {
  const readConfig = dependencies.loadConfig ?? loadConfig;
  const openSessionStore = dependencies.createSessionStore ?? createSessionStore;
  const config = readConfig();

  try {
    const sessionStore = openSessionStore({ workspaceRoot: config.workspaceRoot });

    return {
      initialSession: createInitialSession(sessionStore, config),
      sessionStore,
      sessionStoreError: undefined,
    };
  } catch (error) {
    return {
      initialSession: { resumed: false },
      sessionStore: undefined,
      sessionStoreError: error instanceof Error ? error.message : String(error),
    };
  }
}
