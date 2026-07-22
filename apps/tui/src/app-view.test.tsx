import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { AppView, type AppViewProps } from "./app-view.js";
import type { TranscriptMessage } from "./transcript-types.js";

const landingMessages: TranscriptMessage[] = [
  {
    id: "session-start",
    role: "system",
    parts: [{ id: "session-start:status", type: "status", text: "Session ready" }],
  },
];

function props(overrides: Partial<AppViewProps> = {}): AppViewProps {
  return {
    activeAgentId: "build",
    activeProviderId: "openai/gpt-5",
    activeStatus: "Ready",
    canReadInput: true,
    effectiveModelProviderId: undefined,
    expandedMessageIds: new Set(),
    isBusy: false,
    layoutMode: "fullscreen",
    messages: landingMessages,
    mode: "build",
    onTranscriptLineLimitChange: () => undefined,
    onTranscriptMouseTargetChange: () => undefined,
    pendingPermission: undefined,
    pendingQuestion: undefined,
    pendingSelector: undefined,
    planFilePath: undefined,
    prompt: "",
    promptCursor: 0,
    queuedPromptCount: 0,
    questionAnswer: "",
    questionOptionIndex: 0,
    questionSelectedOptionIndexes: new Set(),
    riskLevel: "low",
    runVisualization: "idle",
    selectedMessageId: "session-start",
    sessionId: "abcdefgh-1234",
    slashCommandSelectionIndex: 0,
    slashCommandSuggestions: [],
    terminalSize: { width: 100, height: 24 },
    todoOpenCount: 2,
    transcriptLineLimit: 12,
    transcriptScrollOffset: 0,
    workspaceRoot: "/Users/alma/Development/magi",
    ...overrides,
  };
}

function renderView(overrides: Partial<AppViewProps> = {}): string {
  const input = props(overrides);
  return stripAnsi(renderToString(<AppView {...input} />, { columns: input.terminalSize.width }));
}

describe("fullscreen AppView landing", () => {
  it("renders a compact landing between the run rail and sticky composer", () => {
    const output = renderView();

    expect(output).toContain("MAGI  build · openai/gpt-5 · abcdefgh");
    expect(output).toContain(" __  __    _    ____ ___");
    expect(output).toContain("Ask for a change, bug fix, or review.");
    expect(output).toContain("Ask for a change...");
    expect(output.indexOf("Ask for a change, bug fix, or review.")).toBeLessThan(
      output.indexOf("Ask for a change..."),
    );
    expect(output).not.toContain("MAGI CODING ASSISTANT");
  });

  it("uses the narrow run rail and keeps every rendered line within terminal width", () => {
    const output = renderView({ terminalSize: { width: 60, height: 20 } });

    expect(output).toContain("MAGI · READY · build");
    expect(output).toContain("[ MAGI ]");
    expect(output).not.toContain(" __  __    _    ____ ___");
    expect(output).not.toContain("/Users/alma/Development/magi");
    expect(output).toContain("Ask for a change, bug fix, or review.");
    expect(output).not.toContain("MAGI CODING ASSISTANT");
    expect(Math.max(...output.split("\n").map((line) => line.length))).toBeLessThanOrEqual(60);
  });

  it("reports the actual flex-allocated transcript height", () => {
    const measuredLimits: number[] = [];
    const input = props({
      onTranscriptLineLimitChange: (lineLimit) => measuredLimits.push(lineLimit),
      terminalSize: { width: 80, height: 24 },
    });

    renderToString(<AppView {...input} />, { columns: input.terminalSize.width });

    expect(measuredLimits.at(-1)).toBeGreaterThanOrEqual(4);
    expect(measuredLimits.at(-1)).toBeLessThan(input.terminalSize.height);
  });
});

describe("fullscreen AppView transcript", () => {
  it("renders transcript messages without the legacy transcript border", () => {
    const messages: TranscriptMessage[] = [
      {
        id: "user-1",
        role: "user",
        parts: [{ id: "user-1:text", type: "text", text: "Fix the tests" }],
      },
      {
        id: "assistant-1",
        role: "assistant",
        agentId: "build",
        parts: [{ id: "assistant-1:text", type: "text", text: "I will inspect them." }],
      },
    ];
    const output = renderView({ messages, selectedMessageId: "assistant-1" });

    expect(output).toContain("│ You");
    expect(output).toContain("Fix the tests");
    expect(output).toContain("I will inspect them.");
    expect(output).not.toContain("┌");
  });

  it("registers tool summary rows as mouse targets", () => {
    const registeredTargets: Array<{ id: string; width: number; height: number }> = [];
    const messages: TranscriptMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            id: "tool-1",
            type: "tool",
            tool: "bash",
            state: {
              input: { command: "pnpm test" },
              output: "ok",
              status: "completed",
              time: { start: 1, end: 2 },
            },
          },
        ],
      },
    ];
    const input = props({
      messages,
      onTranscriptMouseTargetChange: (_key, target) => {
        if (target) registeredTargets.push(target);
      },
    });

    renderToString(<AppView {...input} />, { columns: input.terminalSize.width });

    expect(registeredTargets).toEqual([
      expect.objectContaining({ id: "tool-1", width: expect.any(Number), height: 1 }),
    ]);
  });
});

describe("fullscreen AppView prompt dock", () => {
  it("attaches slash suggestions immediately above the composer", () => {
    const output = renderView({
      prompt: "/m",
      promptCursor: 2,
      slashCommandSuggestions: [
        { name: "model", usage: "/model", description: "Switch model" },
        { name: "mode", usage: "/mode", description: "Show mode" },
      ],
    });
    const suggestionIndex = output.indexOf("/model");
    const composerIndex = output.indexOf("> /m");

    expect(suggestionIndex).toBeGreaterThan(-1);
    expect(composerIndex).toBeGreaterThan(suggestionIndex);
    expect(output).toContain("↑/↓ select · tab/enter complete");
  });

  it("replaces suggestions with a permission dock and contextual footer", () => {
    const output = renderView({
      pendingPermission: {
        call: { id: "call-1", name: "bash", input: { command: "pnpm test" } },
        description: "bash: pnpm test",
        resolve: () => undefined,
      },
      slashCommandSuggestions: [{ name: "model", usage: "/model", description: "Switch model" }],
    });

    expect(output).toContain("Permission Required");
    expect(output).toContain("Input: pnpm test");
    expect(output).not.toContain("/model        Switch model");
    expect(output).toContain("Permission: [y] allow [n] deny [esc] cancel");
  });
});

function stripAnsi(value: string): string {
  const pattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "g");
  return value.replaceAll(pattern, "");
}
