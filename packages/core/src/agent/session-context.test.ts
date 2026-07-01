import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SessionEvent } from "../session.js";
import { buildAgentSessionContext, buildAgentSystemContext } from "./session-context.js";

describe("buildAgentSessionContext", () => {
  it("formats useful session history", () => {
    const context = buildAgentSessionContext({
      events: [
        event(1, "user_message", { content: "What next?" }),
        event(2, "assistant_message", { content: "Read README." }),
        event(3, "verification_result", { command: "pnpm test", status: "passed" }),
      ],
    });

    expect(context).toContain("User: What next?");
    expect(context).toContain("Assistant: Read README.");
    expect(context).toContain("Verification: pnpm test: passed");
  });

  it("limits events and characters", () => {
    const context = buildAgentSessionContext({
      events: [
        event(1, "user_message", { content: "old" }),
        event(2, "assistant_message", { content: "new".repeat(100) }),
      ],
      maxEvents: 1,
      maxCharacters: 80,
    });

    expect(context).not.toContain("old");
    expect(context).toContain("Earlier session context truncated");
  });

  it("prefers summaries and truncates long tool output", () => {
    const context = buildAgentSessionContext({
      events: [
        event(1, "user_message", { content: "old" }),
        event(2, "context_summary", { text: "Earlier useful summary." }),
        event(3, "tool_settlement", {
          name: "grep",
          status: "succeeded",
          outputPreview: "x".repeat(2_000),
        }),
      ],
      maxCharacters: 1_500,
    });

    expect(context).toContain("Earlier context summary");
    expect(context).toContain("Earlier useful summary.");
    expect(context).not.toContain("User: old");
    expect(context).toContain("Tool settlement: grep: succeeded");
    expect(context.length).toBeLessThanOrEqual(
      1_500 + "[Earlier session context truncated]\n".length,
    );
  });
});

describe("buildAgentSystemContext", () => {
  it("injects environment information", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-system-context-"));

    try {
      const context = buildAgentSystemContext({
        workspaceRoot,
        now: new Date("2026-07-01T00:00:00.000Z"),
      }).join("\n\n");

      expect(context).toContain("<env>");
      expect(context).toContain(`Working directory: ${workspaceRoot}`);
      expect(context).toContain(`Workspace root folder: ${workspaceRoot}`);
      expect(context).toContain("Today's date: Wed Jul 01 2026");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("loads the nearest project instruction file", () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-instructions-"));
    const nested = join(workspaceRoot, "packages", "core");

    try {
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(workspaceRoot, "AGENTS.md"), "root instructions");
      writeFileSync(join(nested, "CLAUDE.md"), "nested instructions");

      const context = buildAgentSystemContext({ workspaceRoot, cwd: nested }).join("\n\n");

      expect(context).toContain(`Instructions from: ${join(nested, "CLAUDE.md")}`);
      expect(context).toContain("nested instructions");
      expect(context).not.toContain("root instructions");
    } finally {
      rmSync(workspaceRoot, { recursive: true, force: true });
    }
  });
});

function event(sequence: number, type: SessionEvent["type"], payload: unknown): SessionEvent {
  return {
    id: `${sequence}`,
    sessionId: "session",
    sequence,
    type,
    payload,
    createdAt: new Date(sequence).toISOString(),
  };
}
