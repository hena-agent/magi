import { describe, expect, it } from "vitest";
import { formatReviewRequest, validateReviewResponse } from "./review.js";

describe("validateReviewResponse", () => {
  it("accepts a valid structured review", () => {
    expect(
      validateReviewResponse(
        {
          engineId: "claude",
          summary: "One issue found.",
          findings: [
            {
              severity: "warning",
              lensId: "security",
              file: "src/auth.ts",
              line: 3,
              message: "Token handling needs a guard.",
            },
          ],
          riskScore: 50,
          confidence: 0.8,
        },
        ["security"],
      ).findings,
    ).toHaveLength(1);
  });

  it("rejects invalid severity", () => {
    expect(() =>
      validateReviewResponse({
        engineId: "claude",
        summary: "Bad.",
        findings: [{ severity: "critical", lensId: "security", message: "No." }],
        riskScore: 1,
        confidence: 0.5,
      }),
    ).toThrow(/severity/);
  });

  it("rejects lens ids outside the requested lenses", () => {
    expect(() =>
      validateReviewResponse(
        {
          engineId: "claude",
          summary: "Bad.",
          findings: [{ severity: "warning", lensId: "performance", message: "No." }],
          riskScore: 1,
          confidence: 0.5,
        },
        ["security"],
      ),
    ).toThrow(/not allowed/);
  });
});

describe("formatReviewRequest", () => {
  it("includes lenses and shared context", () => {
    expect(
      formatReviewRequest({
        engineId: "claude",
        lenses: [
          { id: "security", name: "Security", description: "Review safety.", checklist: [] },
        ],
        sharedContextHistory: { entries: [] },
      }),
    ).toContain("Review lenses");
  });
});
