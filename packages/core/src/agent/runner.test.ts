// biome-ignore lint/style/noExcessiveLinesPerFile: runner integration cases share compact test fixtures.
import { expect, it, vi } from "vitest";
import { getAgent } from "./registry.js";
import { type AgentRunEvent, runEventDrivenAgent } from "./runner.js";

it("uses native tool calls before falling back to JSON actions", async () => {
  const executed: string[] = [];
  let stepCalls = 0;
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls > 1) return { text: "", toolCalls: [] };

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

it("continues native tool runs with typed tool-call and tool-result history", async () => {
  const observedMessages: unknown[] = [];
  let stepCalls = 0;

  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "fallback" }) };
      },
      async generateStep(input) {
        stepCalls += 1;
        observedMessages.push(structuredClone(input.messages));

        if (stepCalls === 1) {
          return {
            text: "",
            content: [
              { type: "tool-call", id: "tool-1", name: "read", input: { path: "README.md" } },
            ],
            toolCalls: [{ id: "tool-1", name: "read", input: { path: "README.md" } }],
          };
        }

        return {
          text: "Read README.md.",
          content: [{ type: "text", text: "Read README.md." }],
          toolCalls: [],
        };
      },
    },
    userMessage: "Read README",
    async executeAction() {
      return "README contents";
    },
  });

  expect(result.finalText).toBe("Read README.md.");
  expect(stepCalls).toBe(2);
  expect(observedMessages[1]).toEqual([
    expect.objectContaining({ role: "user" }),
    {
      role: "assistant",
      content: [{ type: "tool-call", id: "tool-1", name: "read", input: { path: "README.md" } }],
    },
    {
      role: "tool",
      toolCallId: "tool-1",
      content: [
        {
          type: "tool-result",
          id: "tool-1",
          name: "read",
          result: { type: "text", value: "README contents" },
        },
      ],
    },
  ]);
});

it("emits assistant status events for provider reasoning text", async () => {
  const events: string[] = [];

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        return { text: "done", reasoningText: "Checking the available context.", toolCalls: [] };
      },
    },
    userMessage: "Answer",
    onEvent(event) {
      if (event.type === "assistant_status") {
        events.push(event.payload.text);
      }
    },
    async executeAction() {
      return "unused";
    },
  });

  expect(events).toEqual(["Checking the available context."]);
});

it("emits assistant stream events while native tool calls are generated", async () => {
  const events: string[] = [];

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep(input) {
        input.onStreamEvent?.({ type: "reasoning_start", id: "r1" });
        input.onStreamEvent?.({ type: "reasoning_delta", id: "r1", text: "Checking files" });
        input.onStreamEvent?.({ type: "tool_input_start", id: "t1", toolName: "grep" });
        input.onStreamEvent?.({
          type: "tool_call",
          id: "t1",
          toolName: "grep",
          input: { pattern: "x" },
        });

        return { text: "done", toolCalls: [] };
      },
    },
    userMessage: "Answer",
    onEvent(event) {
      if (event.type === "assistant_stream") {
        events.push(event.payload.kind);
      }
    },
    async executeAction() {
      return "unused";
    },
  });

  expect(events).toEqual([
    "reasoning_start",
    "reasoning_delta",
    "tool_input_start",
    "tool_call",
    "text_delta",
  ]);
});

it("executes native tool-call-only model responses", async () => {
  let executed = false;
  let stepCalls = 0;

  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "unused" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "tool-1", name: "grep", input: { pattern: "x" } }],
            streamStats: {
              textDeltaCount: 0,
              textCharCount: 0,
              reasoningDeltaCount: 0,
              reasoningCharCount: 0,
              toolCallCount: 1,
              toolNames: ["grep"],
              streamPartTypes: ["tool-call"],
            },
          };
        }

        return { text: "done", toolCalls: [] };
      },
    },
    userMessage: "Search",
    async executeAction(action) {
      expect(action).toEqual({ type: "grep", pattern: "x" });
      executed = true;
      return "grep result";
    },
  });

  expect(executed).toBe(true);
  expect(result.finalText).toBe("done");
});

it("executes parallel-safe native tool calls from one step concurrently", async () => {
  const executed: string[] = [];
  let running = 0;
  let maxRunning = 0;
  let stepCalls = 0;

  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls > 1) {
          return { text: "done", toolCalls: [] };
        }

        return {
          text: "",
          toolCalls: [
            { id: "tool-1", name: "read", input: { path: "README.md" } },
            { id: "tool-2", name: "glob", input: { pattern: "**/*.ts" } },
          ],
        };
      },
    },
    userMessage: "Inspect files",
    async executeAction(action) {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      executed.push(action.type);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;

      return `${action.type} result`;
    },
  });

  expect(executed).toEqual(["read", "glob"]);
  expect(maxRunning).toBe(2);
  expect(result.steps.slice(0, 2).map((step) => step.action.type)).toEqual(["read", "glob"]);
  expect(result.status).toBe("completed");
});

it("keeps mixed native tool calls sequential", async () => {
  const executed: string[] = [];
  let running = 0;
  let maxRunning = 0;
  let stepCalls = 0;

  await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls > 1) {
          return { text: "done", toolCalls: [] };
        }

        return {
          text: "",
          toolCalls: [
            { id: "tool-1", name: "read", input: { path: "README.md" } },
            {
              id: "tool-2",
              name: "apply_patch",
              input: { patchText: "*** Begin Patch\n*** End Patch" },
            },
          ],
        };
      },
    },
    userMessage: "Read then patch",
    async executeAction(action) {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      executed.push(action.type);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;

      return `${action.type} result`;
    },
  });

  expect(executed).toEqual(["read", "apply_patch"]);
  expect(maxRunning).toBe(1);
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
  expect(tools).not.toContain("task");
  expect(tools).not.toContain("webfetch");
  expect(tools).toContain("edit");
  expect(tools).toContain("write");
  expect(tools).not.toContain("apply_patch");
});

it("keeps native tools enabled on the final configured iteration before fallback", async () => {
  const executed: string[] = [];
  let nativeCalls = 0;
  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "final fallback" }) };
      },
      async generateStep() {
        nativeCalls += 1;
        return { text: "", toolCalls: [{ id: "tool-1", name: "plan_exit", input: {} }] };
      },
    },
    agent: getAgent("plan"),
    userMessage: "Plan",
    maxIterations: 1,
    async executeAction(action) {
      executed.push(action.type);
      return "Plan approved.";
    },
  });

  expect(nativeCalls).toBe(1);
  expect(executed).toEqual(["plan_exit"]);
  expect(result.status).toBe("max_iterations");
  expect(result.finalText).toBe("final fallback");
});

it("executes only one plan subagent task per run", async () => {
  const executed: string[] = [];
  let stepCalls = 0;

  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls > 1) return { text: "done", toolCalls: [] };

        return {
          text: "",
          toolCalls: [
            {
              id: "tool-1",
              name: "task",
              input: { description: "Explore one", prompt: "one", subagent_type: "explore" },
            },
            {
              id: "tool-2",
              name: "task",
              input: { description: "Explore two", prompt: "two", subagent_type: "explore" },
            },
          ],
        };
      },
    },
    agent: getAgent("plan"),
    userMessage: "Plan",
    async executeAction(action) {
      executed.push(action.type === "task" ? action.prompt : action.type);
      return `${action.type} result`;
    },
  });

  expect(executed).toEqual(["one"]);
  expect(result.steps.filter((step) => step.action.type === "task")).toHaveLength(2);
  expect(result.steps[1]?.observation).toContain("Additional subagent task skipped");
  expect(result.status).toBe("completed");
});

it("skips overlapping broad glob and grep searches", async () => {
  const executed: string[] = [];
  let stepCalls = 0;

  const result = await runEventDrivenAgent({
    engine: {
      async generateText() {
        return { text: JSON.stringify({ type: "finish", summary: "done" }) };
      },
      async generateStep() {
        stepCalls += 1;
        if (stepCalls > 1) return { text: "done", toolCalls: [] };

        return {
          text: "",
          toolCalls: [
            { id: "tool-1", name: "glob", input: { pattern: "packages/tui/**/*.ts*" } },
            { id: "tool-2", name: "glob", input: { pattern: "packages/tui/**/*.{ts,tsx}" } },
            {
              id: "tool-3",
              name: "grep",
              input: { pattern: "useInput|keypress|escape|abort|cancel|stop" },
            },
            {
              id: "tool-4",
              name: "grep",
              input: { pattern: "useInput|escape|abort|cancel|stop|process.exit" },
            },
          ],
        };
      },
    },
    userMessage: "Search",
    async executeAction(action) {
      if (action.type === "grep" || action.type === "glob") {
        executed.push(`${action.type}:${action.pattern}`);
      }
      return `${action.type} result`;
    },
  });

  expect(executed).toEqual([
    "glob:packages/tui/**/*.ts*",
    "grep:useInput|keypress|escape|abort|cancel|stop",
  ]);
  expect(result.steps[1]?.observation).toContain("Similar broad glob skipped");
  expect(result.steps[3]?.observation).toContain("Similar grep skipped");
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

it("aborts an in-flight native model step without JSON fallback or provider errors", async () => {
  const controller = new AbortController();
  const events: AgentRunEvent[] = [];
  let generateTextCalls = 0;
  let modelStarted = false;
  const run = runEventDrivenAgent({
    engine: {
      async generateText() {
        generateTextCalls += 1;
        return { text: JSON.stringify({ type: "finish", summary: "fallback" }) };
      },
      async generateStep(input) {
        modelStarted = true;
        return new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => reject(input.signal?.reason), {
            once: true,
          });
        });
      },
    },
    userMessage: "Stop in flight",
    signal: controller.signal,
    onEvent(event) {
      events.push(event);
    },
    async executeAction() {
      return "unused";
    },
  });

  await vi.waitFor(() => expect(modelStarted).toBe(true));
  controller.abort();
  const result = await run;

  expect(result.status).toBe("interrupted");
  expect(generateTextCalls).toBe(0);
  expect(events.filter((event) => event.type === "provider_error")).toHaveLength(0);
  expect(
    events.filter(
      (event) => event.type === "agent_step_ended" && event.payload.status === "interrupted",
    ),
  ).toHaveLength(1);
});

it("keeps a non-cooperative model response interrupted after abort", async () => {
  const controller = new AbortController();
  const events: AgentRunEvent[] = [];
  let resolveModel: (value: { text: string }) => void = () => undefined;
  const response = new Promise<{ text: string }>((resolve) => {
    resolveModel = resolve;
  });
  const run = runEventDrivenAgent({
    engine: { generateText: async () => response },
    userMessage: "Stop in flight",
    signal: controller.signal,
    onEvent(event) {
      events.push(event);
    },
    async executeAction() {
      return "unused";
    },
  });

  await vi.waitFor(() =>
    expect(events.some((event) => event.type === "assistant_started")).toBe(true),
  );
  controller.abort();
  resolveModel({ text: JSON.stringify({ type: "finish", summary: "late answer" }) });

  await expect(run).resolves.toMatchObject({
    status: "interrupted",
    finalText: "Agent run interrupted.",
  });
  expect(
    events.filter(
      (event) => event.type === "agent_step_ended" && event.payload.status === "interrupted",
    ),
  ).toHaveLength(1);
  expect(
    events.filter(
      (event) => event.type === "agent_step_ended" && event.payload.status === "completed",
    ),
  ).toHaveLength(0);
});

it("reports interruption when final response generation is aborted", async () => {
  const controller = new AbortController();
  const events: AgentRunEvent[] = [];
  let finalStarted = false;
  const run = runEventDrivenAgent({
    engine: {
      async generateText(input) {
        finalStarted = true;
        return new Promise((_, reject) => {
          input.signal?.addEventListener("abort", () => reject(input.signal?.reason), {
            once: true,
          });
        });
      },
      async generateStep() {
        return {
          text: "",
          toolCalls: [{ id: "read-1", name: "read", input: { path: "README.md" } }],
        };
      },
    },
    userMessage: "Read once",
    signal: controller.signal,
    maxIterations: 1,
    onEvent(event) {
      events.push(event);
    },
    async executeAction() {
      return "contents";
    },
  });

  await vi.waitFor(() => expect(finalStarted).toBe(true));
  controller.abort();
  const result = await run;

  expect(result).toMatchObject({ status: "interrupted", finalText: "Agent run interrupted." });
  expect(events.filter((event) => event.type === "provider_error")).toHaveLength(0);
  expect(
    events.filter(
      (event) => event.type === "agent_step_ended" && event.payload.status === "interrupted",
    ),
  ).toHaveLength(1);
});

it("injects plan reminders only into the system prompt and filters denied plan actions", async () => {
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
  expect(capturedPrompt).not.toContain("<system-reminder>");
  expect(capturedPrompt).not.toContain("Plan mode ACTIVE");
  expect(capturedPrompt).not.toContain("<system-reminder>\n<system-reminder>");
  expect(capturedPrompt).not.toContain('"type": "task"');
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
  expect(capturedSystem).toContain(
    "Use Glob to find files by name and Grep to search file contents.",
  );
  expect(capturedSystem).toContain(
    "For local code questions, inspect directly with focused search/read",
  );
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
