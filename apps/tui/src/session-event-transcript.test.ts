// biome-ignore-all lint/complexity/noExcessiveLinesPerFunction: Characterization cases stay grouped around the extracted converter.
// biome-ignore-all lint/style/noExcessiveLinesPerFile: Resume reconstruction scenarios share event fixtures and one behavior surface.
import type { SessionEvent, SessionEventType } from "@magi/core";
import { describe, expect, it } from "vitest";
import { sessionEventsToTranscriptMessages } from "./session-event-transcript.js";

const baseTime = Date.parse("2026-01-02T03:04:05.000Z");

function event(type: SessionEventType, payload: unknown, sequence: number): SessionEvent {
  return {
    id: `event-${sequence}`,
    sessionId: "session-1",
    sequence,
    type,
    payload,
    createdAt: new Date(baseTime + sequence * 1_000).toISOString(),
  };
}

function stream(kind: string, payload: Record<string, unknown>, sequence: number): SessionEvent {
  return event(
    "assistant_stream",
    { runId: "run-1", stepId: "step-1", kind, ...payload },
    sequence,
  );
}

describe("sessionEventsToTranscriptMessages", () => {
  it("reconstructs user and final assistant messages", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        event("user_message", { content: "Hello", agentId: "build", providerId: "openai" }, 1),
        event("assistant_message", { content: "Hi", model: "gpt-test" }, 2),
      ],
      30,
    );

    expect(messages).toEqual([
      {
        id: "event-1-user",
        role: "user",
        agentId: "build",
        providerId: "openai",
        createdAt: baseTime + 1_000,
        parts: [{ id: "event-1-text", type: "text", text: "Hello" }],
      },
      {
        id: "event-2",
        role: "assistant",
        model: "gpt-test",
        createdAt: baseTime + 2_000,
        completedAt: baseTime + 2_000,
        parts: [{ id: "event-2:text", type: "text", text: "Hi" }],
      },
    ]);
  });

  it("accumulates text deltas into one part", () => {
    const messages = sessionEventsToTranscriptMessages(
      [stream("text_delta", { text: "Hel" }, 1), stream("text_delta", { text: "lo" }, 2)],
      30,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      { id: "assistant:run-1:step-1:text", type: "text", text: "Hello" },
    ]);
  });

  it("reconciles streamed and correlated final text into one canonical part", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("text_delta", { text: "Hel" }, 1),
        stream("text_delta", { text: "lo" }, 2),
        event(
          "assistant_message",
          { content: "Hello", runId: "run-1", stepId: "step-1", model: "gpt-test" },
          3,
        ),
      ],
      30,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "assistant:run-1:step-1",
      completedAt: baseTime + 3_000,
      model: "gpt-test",
      parts: [{ id: "assistant:run-1:step-1:text", type: "text", text: "Hello" }],
    });
  });

  it("uses a complete final message when only a partial response was streamed", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("text_delta", { text: "Partial" }, 1),
        event(
          "assistant_message",
          { content: "Partial response completed", runId: "run-1", stepId: "step-1" },
          2,
        ),
      ],
      30,
    );

    expect(messages[0]?.parts).toEqual([
      {
        id: "assistant:run-1:step-1:text",
        type: "text",
        text: "Partial response completed",
      },
    ]);
  });

  it("resets legacy final-message correlation at each user turn", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        event("user_message", { content: "one" }, 1),
        stream("text_delta", { text: "first" }, 2),
        event("assistant_message", { content: "first" }, 3),
        event("user_message", { content: "two" }, 4),
        event("assistant_message", { content: "second" }, 5),
      ],
      30,
    );

    expect(messages.filter((message) => message.role === "assistant")).toMatchObject([
      { id: "assistant:run-1:step-1", parts: [{ text: "first" }] },
      { id: "event-5", parts: [{ text: "second" }] },
    ]);
  });

  it("keeps a correlated standalone response separate from the preceding agent turn", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("text_delta", { text: "agent response" }, 1),
        event(
          "assistant_message",
          { content: "agent response", runId: "run-1", stepId: "step-1" },
          2,
        ),
        event(
          "assistant_message",
          { content: "revision", runId: "revision-1", stepId: "final" },
          3,
        ),
      ],
      30,
    );

    expect(messages.filter((message) => message.role === "assistant")).toMatchObject([
      { id: "assistant:run-1:step-1", parts: [{ text: "agent response" }] },
      { id: "assistant:revision-1:final", parts: [{ text: "revision" }] },
    ]);
  });

  it("reconstructs reasoning start, deltas, and end", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("reasoning_start", { id: "reason-1" }, 1),
        stream("reasoning_delta", { id: "reason-1", text: "Check " }, 2),
        stream("reasoning_delta", { id: "reason-1", text: "types" }, 3),
        stream("reasoning_end", { id: "reason-1" }, 4),
      ],
      30,
    );

    expect(messages[0]?.parts).toEqual([
      {
        id: "reasoning:reason-1",
        type: "reasoning",
        text: "Check types",
        time: { start: baseTime + 1_000, end: baseTime + 4_000 },
      },
    ]);
  });

  it("assembles tool input JSON and applies completed and error results", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("tool_input_start", { id: "call-1", toolName: "bash" }, 1),
        stream("tool_input_delta", { id: "call-1", delta: '{"command":' }, 2),
        stream("tool_input_delta", { id: "call-1", delta: '"pnpm test"}' }, 3),
        stream("tool_input_end", { id: "call-1" }, 4),
        event("tool_result", { id: "call-1", name: "bash", ok: true, output: "passed" }, 5),
        event("tool_call", { id: "call-2", name: "read", input: { path: "missing.ts" } }, 6),
        event(
          "tool_result",
          { id: "call-2", name: "read", ok: false, output: "ENOENT", error: "not found" },
          7,
        ),
      ],
      30,
    );

    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        id: "tool:call-1",
        state: expect.objectContaining({
          status: "completed",
          input: { command: "pnpm test" },
          output: "passed",
          title: "command complete",
        }),
      }),
      expect.objectContaining({
        id: "tool:call-2",
        state: expect.objectContaining({
          status: "error",
          input: { path: "missing.ts" },
          error: "not found",
          title: "failed",
        }),
      }),
    ]);
  });

  it("marks a repeated tool action as skipped", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("tool_call", { id: "call-1", toolName: "read", input: { path: "src/index.ts" } }, 1),
        event(
          "agent_tool_skipped",
          {
            runId: "run-1",
            stepId: "step-1",
            toolCallId: "call-1",
            toolName: "read",
            input: { path: "src/index.ts" },
            reason: "duplicate",
          },
          2,
        ),
      ],
      30,
    );

    expect(messages[0]?.parts[0]).toMatchObject({
      id: "tool:call-1",
      state: {
        status: "skipped",
        error: "duplicate",
        title: "skipped repeated action",
        metadata: { target: "src/index.ts", summary: "duplicate" },
      },
    });
  });

  it("folds denied and interrupted settlements into tool cards with persisted timing", () => {
    const startedAt = new Date(baseTime + 10).toISOString();
    const endedAt = new Date(baseTime + 510).toISOString();
    const messages = sessionEventsToTranscriptMessages(
      [
        stream("tool_call", { id: "denied-1", toolName: "write", input: { path: "a.ts" } }, 1),
        event(
          "permission_decision",
          { toolCallId: "denied-1", action: "write", decision: "deny" },
          2,
        ),
        event(
          "tool_settlement",
          {
            toolCallId: "denied-1",
            name: "write",
            status: "denied",
            input: { path: "a.ts" },
            endedAt,
          },
          3,
        ),
        stream(
          "tool_call",
          { id: "stopped-1", toolName: "bash", input: { command: "sleep 5" } },
          4,
        ),
        event(
          "tool_settlement",
          {
            toolCallId: "stopped-1",
            name: "bash",
            status: "interrupted",
            input: { command: "sleep 5" },
            startedAt,
            endedAt,
            durationMs: 500,
          },
          5,
        ),
      ],
      30,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]?.parts).toEqual([
      expect.objectContaining({
        id: "tool:denied-1",
        state: expect.objectContaining({ status: "denied" }),
      }),
      expect.objectContaining({
        id: "tool:stopped-1",
        state: expect.objectContaining({
          status: "interrupted",
          metadata: expect.objectContaining({ durationMs: 500 }),
          time: { start: baseTime + 10, end: baseTime + 510 },
        }),
      }),
    ]);
    expect(messages.some((message) => message.role === "system")).toBe(false);
  });

  it("correlates interleaved and out-of-order tool events by toolCallId", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        event("tool_result", { id: "call-a", name: "read", ok: true, output: "A" }, 1),
        event(
          "assistant_stream",
          {
            runId: "run-a",
            stepId: "step-a",
            kind: "tool_call",
            id: "call-a",
            toolName: "read",
            input: { path: "a.ts" },
          },
          2,
        ),
        event(
          "assistant_stream",
          {
            runId: "run-b",
            stepId: "step-b",
            kind: "tool_call",
            id: "call-b",
            toolName: "read",
            input: { path: "b.ts" },
          },
          3,
        ),
        event("tool_result", { id: "call-b", name: "read", ok: true, output: "B" }, 4),
      ],
      30,
    );

    expect(messages).toMatchObject([
      {
        id: "assistant:run-a:step-a",
        parts: [{ id: "tool:call-a", state: { status: "completed", input: { path: "a.ts" } } }],
      },
      {
        id: "assistant:run-b:step-b",
        parts: [{ id: "tool:call-b", state: { status: "completed", input: { path: "b.ts" } } }],
      },
    ]);
  });

  it("surfaces non-routine persisted event categories", () => {
    const visible = [
      event("interruption", { reason: "user_cancelled" }, 1),
      event("queued_user_input", { content: "next", mode: "steering" }, 2),
      event("proposed_patch", { summary: "change a.ts" }, 3),
      event("context_summary", {}, 4),
    ];

    expect(
      sessionEventsToTranscriptMessages(visible, 30).map((message) => message.parts[0]),
    ).toMatchObject([
      { text: "interrupted: user_cancelled" },
      { text: "steering: next" },
      { text: "change a.ts" },
      { text: "context summary" },
    ]);
  });

  it("turns supported system events into status messages", () => {
    const messages = sessionEventsToTranscriptMessages(
      [event("model_switch", { providerId: "openai", model: "gpt-test" }, 1)],
      30,
    );

    expect(messages[0]).toMatchObject({
      id: "event-1",
      role: "system",
      parts: [{ id: "event-1:status", type: "status", text: "openai: gpt-test", tone: "muted" }],
    });
  });

  it("ignores invalid payloads", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        event("user_message", { content: 1 }, 1),
        event("assistant_stream", { runId: "run-1", kind: "text_delta", text: "ignored" }, 2),
        event("tool_result", { id: "call-1", name: "bash", ok: "yes", output: "bad" }, 3),
      ],
      30,
    );

    expect(messages).toEqual([]);
  });

  it("returns only the latest messages up to the limit", () => {
    const messages = sessionEventsToTranscriptMessages(
      [
        event("user_message", { content: "one" }, 1),
        event("user_message", { content: "two" }, 2),
        event("user_message", { content: "three" }, 3),
      ],
      2,
    );

    expect(messages.map((message) => message.id)).toEqual(["event-2-user", "event-3-user"]);
  });
});
