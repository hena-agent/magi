import { describe, expect, it } from "vitest";
import { createMcpClient, createOpenAIModel, createTask } from "./index.js";

describe("createTask", () => {
  it("creates a low-risk normal task", () => {
    const task = createTask("test requirement");

    expect(task.userRequirement).toBe("test requirement");
    expect(task.mode).toBe("normal");
    expect(task.riskLevel).toBe("low");
    expect(task.status).toBe("active");
  });
});

describe("createOpenAIModel", () => {
  it("creates an AI SDK language model", () => {
    const model = createOpenAIModel({ model: "gpt-4.1-mini", apiKey: "test-key" });

    expect(model).toBeDefined();
  });
});

describe("createMcpClient", () => {
  it("creates an MCP client", () => {
    const client = createMcpClient({ name: "magi", version: "0.0.0" });

    expect(client.getServerCapabilities()).toBeUndefined();
  });
});
