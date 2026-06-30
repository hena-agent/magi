import { describe, expect, it } from "vitest";
import { formatVoteRequest, validateVoteResponse } from "./vote.js";

describe("validateVoteResponse", () => {
  it("accepts a valid vote", () => {
    expect(
      validateVoteResponse({
        engineId: "gpt",
        decision: "APPROVE",
        confidence: 0.9,
        riskScore: 12,
        efficiencyScore: 80,
        justification: "Looks safe.",
      }),
    ).toMatchObject({ decision: "APPROVE" });
  });

  it("rejects invalid decisions and out-of-range metrics", () => {
    expect(() =>
      validateVoteResponse({
        engineId: "gpt",
        decision: "MAYBE",
        confidence: 2,
        riskScore: 12,
        efficiencyScore: 80,
        justification: "No.",
      }),
    ).toThrow(/decision/);
  });

  it("rejects unexpected fields", () => {
    expect(() =>
      validateVoteResponse({
        engineId: "gpt",
        decision: "REJECT",
        confidence: 0.5,
        riskScore: 90,
        efficiencyScore: 20,
        justification: "Risky.",
        extra: true,
      }),
    ).toThrow(/Unexpected field/);
  });
});

describe("formatVoteRequest", () => {
  it("includes shared context and schema instruction", () => {
    expect(formatVoteRequest({ engineId: "gpt", sharedContextHistory: { entries: [] } })).toContain(
      "APPROVE or REJECT",
    );
  });
});
