import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore, type SessionEventType } from "@magi/core";
import { describe, expect, it } from "vitest";
import {
  createInitialSession,
  createSessionStartMessage,
  getLatestAgentId,
  getRestoredModelProviderId,
} from "./tui-session-state.js";

const modelProviders: [] = [];

describe("TUI session state helpers", () => {
  it("creates a draft initial session when startup is not resume", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-session-state-"));
    const store = createSessionStore({ workspaceRoot });

    try {
      const initialSession = createInitialSession(store, {
        workspaceRoot,
        modelProviders,
        session: { startup: "new" },
      });

      expect(initialSession).toEqual({ resumed: false });
      expect(createSessionStartMessage(initialSession).parts[0]).toMatchObject({
        id: "session-start:status",
        text: "Draft session: a session will be saved after the first successful prompt.",
      });
    } finally {
      store.close();
    }
  });

  it("resumes the latest session when configured", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-tui-session-state-"));
    const store = createSessionStore({ workspaceRoot });

    try {
      const session = store.createSession({ title: "Existing work" });
      const initialSession = createInitialSession(store, {
        workspaceRoot,
        modelProviders,
        session: { startup: "resume" },
      });

      expect(initialSession).toMatchObject({ resumed: true, session: { id: session.id } });
      expect(createSessionStartMessage(initialSession).parts[0]).toMatchObject({
        text: `Resumed latest session: ${session.id} (Existing work)`,
      });
    } finally {
      store.close();
    }
  });
});

describe("getLatestAgentId", () => {
  it("restores the latest persisted agent switch", () => {
    expect(
      getLatestAgentId([
        event("agent_switch", { agentId: "plan" }),
        event("agent_switch", { agentId: "build" }),
      ]),
    ).toBe("build");
  });

  it("uses the default agent without a valid switch", () => {
    expect(getLatestAgentId([event("summary", {})])).toBe("build");
  });
});

describe("getRestoredModelProviderId", () => {
  it("restores a provider that still exists", () => {
    expect(
      getRestoredModelProviderId(
        [event("model_switch", { providerId: "custom", model: "custom-model" })],
        {
          workspaceRoot: mkdtempSync(join(tmpdir(), "magi-tui-session-state-")),
          modelProviders: [{ id: "custom", provider: "custom", model: "custom-model" }],
        },
      ),
    ).toBe("custom");
  });

  it("falls back to the current default when the persisted provider was removed", () => {
    expect(
      getRestoredModelProviderId(
        [event("model_switch", { providerId: "removed", model: "old-model" })],
        {
          workspaceRoot: mkdtempSync(join(tmpdir(), "magi-tui-session-state-")),
          modelProviders: [],
        },
      ),
    ).toBe("openai");
  });
});

function event(type: SessionEventType, payload: unknown) {
  return {
    id: crypto.randomUUID(),
    sessionId: "session",
    sequence: 1,
    type,
    payload,
    createdAt: new Date().toISOString(),
  };
}
