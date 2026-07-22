import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSessionStore, type SessionStore, type ToolCall } from "@magi/core";
import { expect, it, vi } from "vitest";
import {
  abortableAdapter,
  deferred,
  lifecycleDiagnostics,
  mountController,
  readEventPayloads,
  scriptedAdapter,
  sessionHasAnswers,
  settleRender,
  submitInput,
  successfulTool,
  testConfig,
  textAdapter,
  waitFor,
} from "./app-controller-test-support.js";
import { createAppLifecycle } from "./app-lifecycle.js";

it("loads configuration for the selected target directory", () => {
  const targetDirectory = mkdtempSync(join(tmpdir(), "magi-controller-target-"));
  const workspaceRoot = join(targetDirectory, "workspace");
  const store = createSessionStore({ workspaceRoot: targetDirectory });
  const loadConfigOptions: Array<{ cwd?: string } | undefined> = [];
  const createSessionStoreOptions: Array<{
    workspaceRoot: string;
    project?: string;
    directory?: string;
  }> = [];
  const mount = mountController({
    config: testConfig(workspaceRoot, "new"),
    store,
    adapter: textAdapter("unused"),
    runTool: async (call) => successfulTool(call, []),
    targetDirectory,
    loadConfigOptions,
    createSessionStoreOptions,
  });

  try {
    expect(loadConfigOptions).toEqual([{ cwd: targetDirectory }]);
    expect(createSessionStoreOptions).toEqual([
      { workspaceRoot, project: workspaceRoot, directory: targetDirectory },
    ]);
  } finally {
    mount.app.unmount();
  }
});

it("scrolls the transcript with Up when the composer is empty", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-controller-scroll-"));
  const store = createSessionStore({ workspaceRoot });
  const mount = mountController({
    config: testConfig(workspaceRoot, "new"),
    store,
    adapter: textAdapter("A completed response with enough text for the transcript."),
    runTool: async (call) => successfulTool(call, []),
    fullscreen: true,
  });

  try {
    for (let index = 1; index <= 6; index += 1) {
      await submitInput(mount.streams, `Prompt ${index}`);
      await waitFor(() => sessionHasAnswers(store, index), `answer ${index}`);
    }

    mount.streams.stdin.write("\u001b[A");
    await waitFor(
      () => mount.streams.readOutput().includes("1 lines back"),
      "Up arrow transcript scroll",
      mount.streams.readOutput,
    );
    mount.streams.stdin.write("\u001b[<64;10;10M");
    await waitFor(
      () => mount.streams.readOutput().includes("4 lines back"),
      "mouse wheel transcript scroll",
      mount.streams.readOutput,
    );
  } finally {
    mount.app.unmount();
  }
});

it("persists a tool turn and queued turn in one resumable session", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-controller-lifecycle-"));
  const firstStep = deferred<void>();
  const calls: string[] = [];
  const toolCalls: ToolCall[] = [];
  const adapterSessionIds: string[] = [];
  const firstStore = createSessionStore({ workspaceRoot });
  const firstMount = mountController({
    config: testConfig(workspaceRoot, "new"),
    store: firstStore,
    adapter: scriptedAdapter(firstStep.promise, calls),
    adapterSessionIds,
    runTool: async (call) => successfulTool(call, toolCalls),
  });

  try {
    await waitFor(
      () => firstMount.streams.readOutput().includes("MAGI"),
      "initial render",
      firstMount.streams.readOutput,
    );
    await submitInput(firstMount.streams, "First prompt");
    await waitFor(() => calls.length === 1, "first model step");
    await submitInput(firstMount.streams, "Queued prompt");
    firstStep.resolve();
    await waitFor(
      () => firstMount.streams.readOutput().includes("Permission Required"),
      "write permission prompt",
    );
    await settleRender();
    expect(toolCalls).toHaveLength(0);
    firstMount.streams.stdin.write("y");
    await waitFor(
      () => sessionHasAnswers(firstStore, 2),
      "two persisted answers",
      () => lifecycleDiagnostics(firstStore, calls, firstMount.streams.readOutput()),
    );
    assertSingleLifecycleSession(firstStore, workspaceRoot, toolCalls, adapterSessionIds);
  } finally {
    firstMount.app.unmount();
  }

  await assertStartupResume(workspaceRoot);
}, 15_000);

it("persists denied tool settlement without executing the tool", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-controller-denied-"));
  const store = createSessionStore({ workspaceRoot });
  const calls: string[] = [];
  const toolCalls: ToolCall[] = [];
  const mount = mountController({
    config: testConfig(workspaceRoot, "new"),
    store,
    adapter: scriptedAdapter(Promise.resolve(), calls),
    runTool: async (call) => successfulTool(call, toolCalls),
  });

  try {
    await waitFor(() => mount.streams.readOutput().includes("MAGI"), "initial render");
    await submitInput(mount.streams, "Do not write");
    await waitFor(
      () => mount.streams.readOutput().includes("Permission Required"),
      "permission prompt",
    );
    await settleRender();
    mount.streams.stdin.write("n");
    await waitFor(() => sessionHasAnswers(store, 1), "denied turn answer");

    const session = store.listSessions({ workspaceRoot })[0];
    const events = store.listEvents(session?.id ?? "");
    expect(toolCalls).toHaveLength(0);
    expect(readEventPayloads(events, "permission_decision")).toContainEqual(
      expect.objectContaining({ decision: "deny" }),
    );
    expect(readEventPayloads(events, "tool_settlement")).toContainEqual(
      expect.objectContaining({ status: "denied" }),
    );
  } finally {
    mount.app.unmount();
  }
});

it("interrupts an active run and discards queued prompts without persisting a draft", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-controller-interrupt-"));
  const store = createSessionStore({ workspaceRoot });
  const calls: string[] = [];
  const mount = mountController({
    config: testConfig(workspaceRoot, "new"),
    store,
    adapter: abortableAdapter(calls),
    runTool: async (call) => successfulTool(call, []),
  });

  try {
    await submitInput(mount.streams, "Long task");
    await waitFor(() => calls.length === 1, "active model request");
    await submitInput(mount.streams, "Queued but discarded");
    mount.streams.stdin.write("\u001B");
    await waitFor(
      () => mount.streams.readOutput().includes("Discarded 1 queued prompt"),
      "interruption cleanup",
    );
    expect(store.listSessions({ workspaceRoot })).toEqual([]);
  } finally {
    mount.app.unmount();
  }
});

it("aborts and awaits the foreground run before closing the store on shutdown", async () => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), "magi-controller-shutdown-"));
  const store = createSessionStore({ workspaceRoot });
  const close = vi.spyOn(store, "close");
  const calls: string[] = [];
  const lifecycle = createAppLifecycle();
  const mount = mountController({
    config: testConfig(workspaceRoot, "new"),
    store,
    adapter: abortableAdapter(calls),
    runTool: async (call) => successfulTool(call, []),
    lifecycle,
  });

  try {
    await submitInput(mount.streams, "Long task");
    await waitFor(() => calls.length === 1, "active model request");
    await lifecycle.shutdown("sigterm");

    expect(close).toHaveBeenCalledOnce();
  } finally {
    mount.app.unmount();
  }
});

async function assertStartupResume(workspaceRoot: string): Promise<void> {
  const store = createSessionStore({ workspaceRoot });
  const mount = mountController({
    config: testConfig(workspaceRoot, "resume"),
    store,
    adapter: textAdapter("Resumed answer"),
    runTool: async (call) => successfulTool(call, []),
  });

  try {
    await submitInput(mount.streams, "Resumed prompt");
    await waitFor(() => sessionHasAnswers(store, 3), "resumed answer");
    const sessions = store.listSessions({ workspaceRoot });
    expect(sessions).toHaveLength(1);
    expect(
      store.listEvents(sessions[0]?.id ?? "").filter((event) => event.type === "user_message"),
    ).toHaveLength(3);
  } finally {
    mount.app.unmount();
  }
}

function assertSingleLifecycleSession(
  store: SessionStore,
  workspaceRoot: string,
  toolCalls: ToolCall[],
  adapterSessionIds: string[],
): void {
  const sessions = store.listSessions({ workspaceRoot });
  expect(sessions).toHaveLength(1);
  const sessionId = sessions[0]?.id ?? "";
  const events = store.listEvents(sessionId);
  expect(events.filter((event) => event.type === "user_message")).toHaveLength(2);
  expect(events.filter((event) => event.type === "assistant_message")).toHaveLength(2);
  expect(readEventPayloads(events, "user_message")).toEqual([
    expect.objectContaining({ content: "First prompt" }),
    expect.objectContaining({ content: "Queued prompt", source: "queued" }),
  ]);
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "queued_user_input" }),
      expect.objectContaining({ type: "permission_decision" }),
      expect.objectContaining({ type: "tool_result" }),
    ]),
  );
  expect(toolCalls).toHaveLength(1);
  expect(adapterSessionIds.at(-1)).toBe(sessionId);
}
