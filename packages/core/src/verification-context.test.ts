import { describe, expect, it } from "vitest";
import type { SessionEvent } from "./session.js";
import { getLatestVerificationFailures, truncateTail } from "./verification-context.js";

describe("getLatestVerificationFailures", () => {
  it("extracts latest failed verification events", () => {
    const context = getLatestVerificationFailures({
      events: [
        event(1, "verification_result", { command: "pnpm test", status: "passed" }),
        event(2, "verification_result", {
          command: "pnpm typecheck",
          status: "failed",
          exitCode: 2,
          durationMs: 100,
          stdout: "out",
          stderr: "err",
        }),
        event(3, "verification_result", {
          command: "pnpm lint",
          status: "failed",
          exitCode: 1,
          durationMs: 50,
          stdout: "",
          stderr: "lint",
        }),
      ],
      limit: 1,
    });

    expect(context.failures).toHaveLength(1);
    expect(context.failures[0]?.command).toBe("pnpm lint");
    expect(context.text).toContain("pnpm lint");
  });

  it("ignores malformed payloads", () => {
    const context = getLatestVerificationFailures({
      events: [event(1, "verification_result", { status: "failed" })],
    });

    expect(context.failures).toEqual([]);
    expect(context.text).toBe("No verification failures found.");
  });
});

describe("truncateTail", () => {
  it("keeps the tail when truncating", () => {
    expect(truncateTail("abcdef", 3)).toBe("[truncated 3 chars]\ndef");
  });
});

function event(sequence: number, type: SessionEvent["type"], payload: unknown): SessionEvent {
  return {
    id: `event-${sequence}`,
    sessionId: "session",
    sequence,
    type,
    payload,
    createdAt: `2026-01-01T00:00:0${sequence}.000Z`,
  };
}
