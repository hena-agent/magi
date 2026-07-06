import { expect, it } from "vitest";
import { getAgent } from "./registry.js";
import { runEventDrivenAgent } from "./runner.js";

it("uses native tool calls before falling back to JSON actions", async () => {
  const executed: string[] = [];
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        return {
          text: "",
          toolCalls: [{ id: "tool-1", name: "read", input: { path: "README.md" } }],
        };
      },
    },
    userMessage: "Read README",
    async executeAction(action) {
      executed.push(action.type);
      return "README contents";
    },
  });

  expect(executed).toEqual(["read"]);
  expect(result.status).toBe("completed");
  expect(result.finalText).toBe("done");
});

it("exposes apply_patch for GPT Codex-style models", async () => {
  let tools: string[] = [];
  let stepCalls = 0;
  const result = await runEventDrivenAgent({
    engine: {
      provider: { id: "openai", provider: "openai", model: "gpt-5.5-codex" },
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep(input) {
        stepCalls += 1;
        tools = input.tools.map((tool) => tool.name);
        if (stepCalls > 1) {
          return { text: "done", toolCalls: [] };
        }
        return {
          text: "",
          toolCalls: [
            {
              id: "tool-1",
              name: "apply_patch",
              input: { patchText: "*** Begin Patch\n*** End Patch" },
            },
          ],
        };
      },
    },
    userMessage: "Patch",
    async executeAction(action) {
      expect(action.type).toBe("apply_patch");
      return "patched";
    },
  });

  expect(tools).toContain("apply_patch");
  expect(tools).not.toContain("edit");
  expect(tools).not.toContain("write");
  expect(result.status).toBe("completed");
});

it("exposes edit and write for non-Codex models", async () => {
  let tools: string[] = [];
  let stepCalls = 0;
  const result = await runEventDrivenAgent({
    engine: {
      provider: { id: "claude", provider: "custom", model: "claude-sonnet-4-5" },
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep(input) {
        stepCalls += 1;
        tools = input.tools.map((tool) => tool.name);
        if (stepCalls > 1) {
          return { text: "done", toolCalls: [] };
        }
        return {
          text: "",
          toolCalls: [
            {
              id: "tool-1",
              name: "edit",
              input: { filePath: "README.md", oldString: "old", newString: "new" },
            },
          ],
        };
      },
    },
    userMessage: "Edit",
    async executeAction(action) {
      expect(action.type).toBe("edit");
      return "edited";
    },
  });

  expect(tools).toContain("edit");
  expect(tools).toContain("write");
  expect(tools).toContain("webfetch");
  expect(tools).toContain("todowrite");
  expect(tools).toContain("question");
  expect(tools).toContain("skill");
  expect(tools).toContain("task");
  expect(tools).not.toContain("apply_patch");
  expect(result.status).toBe("completed");
});

it("filters network tools from the plan agent while keeping planning tools", async () => {
  let tools: string[] = [];

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "planned" }) };
      },
      async generateStep(input) {
        tools = input.tools.map((tool) => tool.name);

        return { text: "planned", toolCalls: [] };
      },
    },
    agent: getAgent("plan"),
    userMessage: "Plan",
    async executeAction() {
      return "unused";
    },
  });

  expect(tools).toContain("read");
  expect(tools).toContain("todowrite");
  expect(tools).toContain("question");
  expect(tools).toContain("skill");
  expect(tools).toContain("task");
  expect(tools).not.toContain("webfetch");
  expect(tools).toContain("edit");
  expect(tools).toContain("write");
  expect(tools).not.toContain("apply_patch");
});

it("stops at a safe point when interrupted", async () => {
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "unused" }) };
      },
    },
    userMessage: "Stop",
    shouldInterrupt() {
      return true;
    },
    async executeAction() {
      return "unused";
    },
  });

  expect(result.status).toBe("interrupted");
  expect(result.finalText).toBe("Agent run interrupted.");
});

it("injects plan reminders into the system and user prompt and filters denied plan actions", async () => {
  let capturedSystem = "";
  let capturedPrompt = "";
  const result = await runEventDrivenAgent({
    engine: {
      async generateText(input) {
        capturedSystem = input.system ?? "";
        capturedPrompt = input.prompt;

        return { text: JSON.stringify({ type: "finish", summary: "planned" }) };
      },
    },
    agent: getAgent("plan"),
    userMessage: "Plan this",
    async executeAction() {
      return "unused";
    },
  });

  expect(result.finalText).toBe("planned");
  expect(capturedSystem).toContain("Plan mode ACTIVE");
  expect(capturedPrompt).toContain("<system-reminder>");
  expect(capturedPrompt).toContain("Plan mode ACTIVE");
  expect(capturedPrompt).not.toContain("<system-reminder>\n<system-reminder>");
  expect(capturedPrompt).not.toContain("propose_patch");
  expect(capturedPrompt).not.toContain("verify");
});

it("injects plan reminders into native tool-call system prompts", async () => {
  let capturedSystem = "";

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "planned" }) };
      },
      async generateStep(input) {
        capturedSystem = input.system ?? "";

        return { text: "planned", toolCalls: [] };
      },
    },
    agent: getAgent("plan"),
    userMessage: "Plan this",
    async executeAction() {
      return "unused";
    },
  });

  expect(capturedSystem).toContain("Plan mode ACTIVE");
  expect(capturedSystem).toContain("Use tools only when needed for the current agent permissions.");
  expect(capturedSystem).not.toContain("inspect or modify");
});

it("appends OpenCode-style system context to the system prompt", async () => {
  let capturedSystem = "";

  await runEventDrivenAgent({
    engine: {
      async generateText(input) {
        capturedSystem = input.system ?? "";

        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
    },
    userMessage: "Use context",
    systemContext: ["<env>\n  Working directory: /tmp/repo\n</env>"],
    async executeAction() {
      return "unused";
    },
  });

  expect(capturedSystem).toContain("<env>");
  expect(capturedSystem).toContain("Working directory: /tmp/repo");
});
