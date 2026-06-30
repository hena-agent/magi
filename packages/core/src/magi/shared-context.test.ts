import { describe, expect, it } from "vitest";
import type { SessionEvent } from "../session.js";
import { buildSharedContextHistory } from "./shared-context.js";

describe("buildSharedContextHistory", () => {
  it("starts with requirement and includes plan and diff", () => {
    expect(
      buildSharedContextHistory({
        requirement: "Fix tests",
        plan: "Read failures",
        diff: "diff --git a/a b/a",
        createdAt: "now",
      }).entries.map((entry) => entry.type),
    ).toEqual(["requirement", "plan", "diff"]);
  });

  it("converts verification, proposed patch, and revision events", () => {
    const history = buildSharedContextHistory({
      requirement: "Fix tests",
      sessionEvents: [
        event(1, "verification_result", {
          command: "pnpm test",
          exitCode: 1,
          stdout: "out",
          stderr: "err",
        }),
        event(2, "proposed_patch", { patch: "diff --git a/a b/a" }),
        event(3, "assistant_message", { content: "Try this patch", revision: true }),
      ],
    });

    expect(history.entries.map((entry) => entry.type)).toEqual([
      "requirement",
      "verification",
      "diff",
      "revision",
    ]);
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
