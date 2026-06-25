import { describe, expect, it } from "vitest";
import { createTask } from "./index.js";

describe("createTask", () => {
  it("creates a low-risk normal task", () => {
    const task = createTask("test requirement");

    expect(task.userRequirement).toBe("test requirement");
    expect(task.mode).toBe("normal");
    expect(task.riskLevel).toBe("low");
    expect(task.status).toBe("active");
  });
});
