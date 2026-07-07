import { describe, expect, it } from "vitest";
import type { SessionEvent } from "./session.js";
import { planSessionMaintenance } from "./session-maintenance.js";

describe("planSessionMaintenance", () => {
  it("generates title candidates for untitled meaningful sessions", () => {
    const plan = planSessionMaintenance({
      session: session("Untitled session"),
      events: [event(1, "user_message", { content: "Implement a safer session runner" })],
    });

    expect(plan.titleCandidate).toBe("Implement a safer session runner");
    expect(plan.cleanupCandidate).toBe(false);
  });

  it("marks empty and command-only sessions as cleanup candidates without deleting them", () => {
    const plan = planSessionMaintenance({
      session: session("MAGI TUI session"),
      events: [event(1, "tool_settlement", { name: "read", status: "succeeded" })],
    });

    expect(plan.cleanupCandidate).toBe(true);
    expect(plan.cleanupReason).toBe("empty or command-only session");
  });

  it("creates compact summary candidates after enough events", () => {
    const events = Array.from({ length: 4 }, (_, index) =>
      event(index + 1, "user_message", { content: `Meaningful request ${index}` }),
    );
    const plan = planSessionMaintenance({
      session: session("Real session"),
      events,
      minEventsForSummary: 3,
    });

    expect(plan.summaryCandidate).toContain("Meaningful request");
  });

  it("does not treat workspace summaries as maintenance checkpoints", () => {
    const events = [
      event(1, "summary", { text: "Changed files:\n- apps/tui/package.json" }),
      event(2, "user_message", { content: "Meaningful request after summary" }),
      event(3, "assistant_message", { content: "Important plan after summary" }),
    ];
    const plan = planSessionMaintenance({
      session: session("Real session"),
      events,
      minEventsForSummary: 3,
    });

    expect(plan.summaryCandidate).toContain("Meaningful request after summary");
    expect(plan.summaryCandidate).toContain("Important plan after summary");
  });
});

function session(title: string) {
  return {
    id: "session",
    workspaceRoot: "/workspace",
    title,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function event(sequence: number, type: SessionEvent["type"], payload: unknown): SessionEvent {
  return {
    id: `${sequence}`,
    sessionId: "session",
    sequence,
    type,
    payload,
    createdAt: new Date(sequence).toISOString(),
  };
}
