import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../session.js";
import { buildAgentSessionContext } from "./session-context.js";

describe("buildAgentSessionContext", () => {
  it("formats useful session history", () => {
    const context = buildAgentSessionContext({
      events: [
        event(1, "user_message", { content: "What next?" }),
        event(2, "assistant_message", { content: "Read README." }),
        event(3, "verification_result", { command: "pnpm test", status: "passed" }),
      ],
    });

    expect(context).toContain("User: What next?");
    expect(context).toContain("Assistant: Read README.");
    expect(context).toContain("Verification: pnpm test: passed");
  });

  it("limits events and characters", () => {
    const context = buildAgentSessionContext({
      events: [
        event(1, "user_message", { content: "old" }),
        event(2, "assistant_message", { content: "new".repeat(100) }),
      ],
      maxEvents: 1,
      maxCharacters: 80,
    });

    expect(context).not.toContain("old");
    expect(context).toContain("Earlier session context truncated");
  });
});

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
