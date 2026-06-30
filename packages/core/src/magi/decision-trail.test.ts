import { describe, expect, it } from "vitest";
import { createDecisionTrail } from "./decision-trail.js";
import type { VoteResponse } from "./vote.js";

describe("createDecisionTrail", () => {
  it("creates a replayable trail with consensus result", () => {
    const trail = createDecisionTrail({
      requirement: "Fix tests",
      sharedContextHistory: {
        entries: [{ type: "requirement", content: "Fix tests", createdAt: "now" }],
      },
      reviews: [],
      votes: [vote(1, "APPROVE"), vote(2, "APPROVE"), vote(3, "REJECT")],
      createdAt: "now",
    });

    expect(trail.requirement).toBe("Fix tests");
    expect(trail.consensusResult.outcome).toBe("DEADLOCK");
    expect(trail.id).toBeTruthy();
  });
});

function vote(index: number, decision: VoteResponse["decision"]): VoteResponse {
  return {
    engineId: `engine-${index}`,
    decision,
    confidence: 0.8,
    riskScore: 20,
    efficiencyScore: 70,
    justification: "Because.",
  };
}
