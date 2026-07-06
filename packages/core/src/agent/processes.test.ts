import { describe, expect, it } from "vitest";
import { getDefaultAgentProcess, listAgentProcesses } from "./processes.js";

describe("agent processes", () => {
  it("defines the plan subprocess sequence", () => {
    expect(listAgentProcesses("plan")).toEqual(["spec", "validate", "compose", "done"]);
    expect(getDefaultAgentProcess("plan")).toBe("spec");
  });

  it("defines the build subprocess sequence", () => {
    expect(listAgentProcesses("build")).toEqual(["execute", "verify", "test", "harness", "done"]);
    expect(getDefaultAgentProcess("build")).toBe("execute");
  });

  it("returns no processes for unknown agents", () => {
    expect(listAgentProcesses("explore")).toEqual([]);
    expect(getDefaultAgentProcess("explore")).toBeUndefined();
  });
});
