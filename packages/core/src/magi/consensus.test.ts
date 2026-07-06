import { describe, expect, it } from "vitest";
import { evaluateConsensus, evaluateUnanimousConsensus } from "./consensus.js";
import type { VoteResponse } from "./vote.js";

describe("evaluateConsensus", () => {
  it.each([
    [["APPROVE", "APPROVE", "APPROVE"], "PASS"],
    [["APPROVE", "APPROVE", "REJECT"], "DEADLOCK"],
    [["APPROVE", "REJECT", "REJECT"], "FAIL"],
    [["REJECT", "REJECT", "REJECT"], "REJECT"],
  ] as const)("maps %s to %s", (decisions, outcome) => {
    expect(
      evaluateConsensus(decisions.map((decision, index) => vote(index, decision))).outcome,
    ).toBe(outcome);
  });

  it("requires exactly three votes", () => {
    expect(() => evaluateConsensus([vote(1, "APPROVE")])).toThrow(/exactly 3/);
  });

  it("rejects duplicate engine ids", () => {
    expect(() =>
      evaluateConsensus([
        { ...vote(1, "APPROVE"), engineId: "same" },
        { ...vote(2, "APPROVE"), engineId: "same" },
        vote(3, "APPROVE"),
      ]),
    ).toThrow(/unique/);
  });
});

describe("evaluateUnanimousConsensus", () => {
  it.each([
    [["APPROVE", "APPROVE"], "PASS"],
    [["APPROVE", "REJECT"], "DEADLOCK"],
    [["REJECT", "REJECT"], "REJECT"],
    [["APPROVE", "APPROVE", "APPROVE", "APPROVE"], "PASS"],
  ] as const)("maps %s to %s", (decisions, outcome) => {
    expect(
      evaluateUnanimousConsensus(decisions.map((decision, index) => vote(index, decision))).outcome,
    ).toBe(outcome);
  });

  it("requires at least two votes", () => {
    expect(() => evaluateUnanimousConsensus([vote(1, "APPROVE")])).toThrow(/at least 2/);
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
