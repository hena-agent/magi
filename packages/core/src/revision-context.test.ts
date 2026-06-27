import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildRevisionContext,
  extractFirstDiffBlock,
  getLatestProposedPatch,
} from "./revision-context.js";
import type { SessionEvent } from "./session.js";

describe("buildRevisionContext", () => {
  it("combines messages, changed files, and verification failures", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-revision-test-"));
    execSync("git init", { cwd: workspaceRoot });
    writeFileSync(join(workspaceRoot, "changed.ts"), "export {};\n");

    const context = buildRevisionContext({
      workspaceRoot,
      events: [
        event(1, "user_message", { content: "fix typecheck" }),
        event(2, "assistant_message", { content: "I changed code." }),
        event(3, "verification_result", {
          command: "pnpm typecheck",
          status: "failed",
          exitCode: 2,
          durationMs: 10,
          stdout: "",
          stderr: "type error",
        }),
      ],
    });

    expect(context.latestUserMessage).toBe("fix typecheck");
    expect(context.changedFiles).toEqual(["changed.ts"]);
    expect(context.verificationFailures[0]?.command).toBe("pnpm typecheck");
    expect(context.text).toContain("type error");
  });
});

describe("extractFirstDiffBlock", () => {
  it("extracts the first fenced diff block", () => {
    expect(extractFirstDiffBlock("```diff\ndiff --git a/a b/a\n```"))?.toBe("diff --git a/a b/a");
  });
});

describe("getLatestProposedPatch", () => {
  it("returns latest proposed patch payload", () => {
    expect(
      getLatestProposedPatch([
        event(1, "proposed_patch", { patch: "old" }),
        event(2, "proposed_patch", { patch: "new" }),
      ]),
    ).toBe("new");
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
