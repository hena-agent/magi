import { describe, expect, it } from "vitest";
import { agentActionToToolName, validateAgentAction } from "./actions.js";

describe("validateAgentAction", () => {
  it("validates supported actions", () => {
    expect(validateAgentAction({ type: "read", path: "README.md" })).toEqual({
      type: "read",
      path: "README.md",
    });
    expect(validateAgentAction({ type: "verify" })).toEqual({ type: "verify" });
    expect(
      validateAgentAction({
        type: "edit",
        filePath: "README.md",
        oldString: "old",
        newString: "new",
        replaceAll: true,
      }),
    ).toEqual({
      type: "edit",
      filePath: "README.md",
      oldString: "old",
      newString: "new",
      replaceAll: true,
    });
    expect(validateAgentAction({ type: "write", filePath: "new.txt", content: "" })).toEqual({
      type: "write",
      filePath: "new.txt",
      content: "",
    });
    expect(
      validateAgentAction({ type: "apply_patch", patchText: "*** Begin Patch\n*** End Patch" }),
    ).toEqual({ type: "apply_patch", patchText: "*** Begin Patch\n*** End Patch" });
    expect(validateAgentAction({ type: "skill", name: "demo" })).toEqual({
      type: "skill",
      name: "demo",
    });
    expect(
      validateAgentAction({
        type: "task",
        description: "Explore docs",
        prompt: "Read docs",
        subagent_type: "explore",
        background: true,
      }),
    ).toEqual({
      type: "task",
      description: "Explore docs",
      prompt: "Read docs",
      subagent_type: "explore",
      background: true,
    });
  });

  it("rejects unsupported actions", () => {
    expect(() => validateAgentAction({ type: "deploy" })).toThrow(/Unsupported/);
  });
});

describe("agentActionToToolName", () => {
  it("maps read-like actions to tool names", () => {
    expect(agentActionToToolName({ type: "grep", pattern: "x" })).toBe("grep");
    expect(
      agentActionToToolName({ type: "edit", filePath: "a", oldString: "x", newString: "y" }),
    ).toBe("edit");
    expect(agentActionToToolName({ type: "write", filePath: "a", content: "" })).toBe("write");
    expect(agentActionToToolName({ type: "apply_patch", patchText: "patch" })).toBe("apply_patch");
    expect(agentActionToToolName({ type: "skill", name: "demo" })).toBe("skill");
    expect(
      agentActionToToolName({
        type: "task",
        description: "Explore",
        prompt: "Read",
        subagent_type: "explore",
      }),
    ).toBe("task");
    expect(agentActionToToolName({ type: "verify" })).toBeUndefined();
  });
});
