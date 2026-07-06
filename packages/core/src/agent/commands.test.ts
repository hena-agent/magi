import { describe, expect, it } from "vitest";
import { getAgentCommand, listAgentCommandIds, listAgentCommands } from "./commands.js";

describe("agent commands", () => {
  it("exposes the plan agent command surface", () => {
    expect(listAgentCommandIds("plan")).toEqual(["plan", "validate", "done"]);
    expect(listAgentCommands("plan").map((command) => command.slash)).toEqual([
      "/plan",
      "/validate",
      "/done",
    ]);
  });

  it("exposes the build agent command surface", () => {
    expect(listAgentCommandIds("build")).toEqual([
      "plan",
      "build",
      "validate",
      "verify",
      "test",
      "harness",
      "done",
    ]);
    expect(getAgentCommand("build", "verify")?.kind).toBe("verification");
  });

  it("returns no commands for agents without a command surface", () => {
    expect(listAgentCommands("explore")).toEqual([]);
    expect(getAgentCommand("explore", "verify")).toBeUndefined();
  });
});
