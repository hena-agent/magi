import { describe, expect, it } from "vitest";
import { getAgentCommand, listAgentCommandIds, listAgentCommands } from "./commands.js";

describe("agent commands", () => {
  it("exposes the plan agent command surface", () => {
    expect(listAgentCommandIds("plan")).toEqual(["plan", "done"]);
    expect(listAgentCommands("plan").map((command) => command.slash)).toEqual(["/plan", "/done"]);
  });

  it("exposes the build agent command surface", () => {
    expect(listAgentCommandIds("build")).toEqual(["plan", "build", "done"]);
    expect(getAgentCommand("build", "done")?.kind).toBe("checkpoint");
  });

  it("returns no commands for agents without a command surface", () => {
    expect(listAgentCommands("explore")).toEqual([]);
    expect(getAgentCommand("explore", "verify")).toBeUndefined();
  });
});
