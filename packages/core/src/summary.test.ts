import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeWorkspace } from "./summary.js";

describe("summarizeWorkspace", () => {
  it("summarizes changed files and verification events", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-summary-test-"));
    execSync("git init", { cwd: workspaceRoot });
    writeFileSync(join(workspaceRoot, "changed.txt"), "changed\n");

    const summary = summarizeWorkspace({
      workspaceRoot,
      events: [
        {
          id: "event",
          sessionId: "session",
          sequence: 1,
          type: "verification_result",
          payload: { command: "pnpm test", status: "passed" },
          createdAt: new Date().toISOString(),
        },
      ],
    });

    expect(summary.changedFiles).toEqual(["changed.txt"]);
    expect(summary.residualRisk).toBe("low");
    expect(summary.text).toContain("pnpm test: passed");
  });
});
