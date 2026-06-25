import { describe, expect, it } from "vitest";
import { createCommandResult } from "./index.js";

describe("createCommandResult", () => {
  it("marks zero exit codes as passed", () => {
    expect(createCommandResult("pnpm test", 0, 12).status).toBe("passed");
  });

  it("marks non-zero exit codes as failed", () => {
    expect(createCommandResult("pnpm test", 1, 12).status).toBe("failed");
  });
});
