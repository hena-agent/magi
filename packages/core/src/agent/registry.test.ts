import { describe, expect, it } from "vitest";
import {
  getAgent,
  getDefaultAgent,
  listAgents,
  listPrimaryAgents,
  mergeAgentPermission,
} from "./registry.js";

describe("agent registry", () => {
  it("provides built-in agents without config", () => {
    const names = listAgents({ includeHidden: true }).map((agent) => agent.id);

    expect(names).toEqual([
      "build",
      "plan",
      "general",
      "explore",
      "compaction",
      "title",
      "summary",
    ]);
    expect(getDefaultAgent().id).toBe("build");
    expect(listPrimaryAgents().map((agent) => agent.id)).toEqual(["build", "plan"]);
  });

  it("wires OpenCode-style prompts into built-in agents", () => {
    expect(getAgent("build")?.prompt).toContain("You are MAGI");
    expect(getAgent("plan")?.prompt).toBe(getAgent("build")?.prompt);
    expect(getAgent("explore")?.prompt).toContain("file search specialist");
    expect(getAgent("compaction")?.hidden).toBe(true);
  });

  it("keeps agent denies as hard ceilings over global permissions", () => {
    const plan = getAgent("plan");

    if (!plan) {
      throw new Error("plan agent missing");
    }

    expect(
      mergeAgentPermission(plan, {
        read: "allow",
        write: "allow",
        shell: "allow",
        network: "allow",
      }),
    ).toEqual({ read: "allow", write: "deny", shell: "deny", network: "deny" });
  });
});
