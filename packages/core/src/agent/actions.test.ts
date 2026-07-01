import { describe, expect, it } from "vitest";
import { agentActionToToolName, validateAgentAction } from "./actions.js";

describe("validateAgentAction", () => {
  it("validates supported actions", () => {
    expect(validateAgentAction({ type: "read", path: "README.md" })).toEqual({
      type: "read",
      path: "README.md",
    });
    expect(validateAgentAction({ type: "verify" })).toEqual({ type: "verify" });
  });

  it("rejects unsupported actions", () => {
    expect(() => validateAgentAction({ type: "deploy" })).toThrow(/Unsupported/);
  });
});

describe("agentActionToToolName", () => {
  it("maps read-like actions to tool names", () => {
    expect(agentActionToToolName({ type: "grep", pattern: "x" })).toBe("grep");
    expect(agentActionToToolName({ type: "verify" })).toBeUndefined();
  });
});
