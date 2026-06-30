import { describe, expect, it } from "vitest";
import { selectReviewLenses } from "./lenses.js";

describe("selectReviewLenses", () => {
  it("selects low-risk baseline lenses", () => {
    expect(
      selectReviewLenses({ riskLevel: "low", changedFiles: [] }).map((lens) => lens.id),
    ).toEqual(["correctness", "maintainability"]);
  });

  it("adds architecture for medium risk", () => {
    expect(
      selectReviewLenses({ riskLevel: "medium", changedFiles: [] }).map((lens) => lens.id),
    ).toContain("architecture");
  });

  it("adds all core lenses for high risk", () => {
    expect(
      selectReviewLenses({ riskLevel: "high", changedFiles: [] }).map((lens) => lens.id),
    ).toEqual(["correctness", "maintainability", "architecture", "security", "performance"]);
  });

  it("adds sensitivity-driven lenses and removes duplicates", () => {
    expect(
      selectReviewLenses({
        riskLevel: "low",
        changedFiles: ["src/auth/token.ts", "src/build/cache.ts"],
        explicitLensIds: ["security", "architecture"],
      }).map((lens) => lens.id),
    ).toEqual(["correctness", "maintainability", "security", "performance", "architecture"]);
  });
});
