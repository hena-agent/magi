import { PassThrough } from "node:stream";
import type { LoadConfigOptions, MagiConfig } from "@magi/config";
import type { PrimaryModelAdapter, SessionStore, ToolCall, ToolResult } from "@magi/core";
import { render } from "ink";
import { AppController } from "./app-controller.js";
import type { AppControllerDependencies } from "./app-controller-dependencies.js";
import type { AppLifecycle } from "./app-lifecycle.js";

export type TestStreams = {
  stdin: PassThrough & NodeJS.ReadStream;
  stdout: NodeJS.WriteStream;
  readOutput: () => string;
};

export function mountController(input: {
  config: MagiConfig;
  store: SessionStore;
  adapter: PrimaryModelAdapter;
  runTool: AppControllerDependencies["runTool"];
  adapterSessionIds?: string[];
  lifecycle?: AppLifecycle;
  fullscreen?: boolean;
  targetDirectory?: string;
  loadConfigOptions?: Array<LoadConfigOptions | undefined>;
  createSessionStoreOptions?: Array<Parameters<AppControllerDependencies["createSessionStore"]>[0]>;
}) {
  const streams = createTestStreams();
  const app = render(
    <AppController
      dependencies={{
        loadConfig: (options) => {
          input.loadConfigOptions?.push(options);
          return input.config;
        },
        createSessionStore: (options) => {
          input.createSessionStoreOptions?.push(options);
          return input.store;
        },
        createPrimaryModelAdapter: (adapterInput) => {
          input.adapterSessionIds?.push(adapterInput.sessionId ?? "");
          return input.adapter;
        },
        runTool: input.runTool,
      }}
      lifecycle={input.lifecycle}
      fullscreen={input.fullscreen === true}
      {...(input.targetDirectory === undefined ? {} : { targetDirectory: input.targetDirectory })}
    />,
    {
      stdin: streams.stdin,
      stdout: streams.stdout,
      stderr: streams.stdout,
      exitOnCtrlC: false,
      patchConsole: false,
      maxFps: 120,
    },
  );
  return { app, streams };
}

function createTestStreams(): TestStreams {
  const stdin = new PassThrough() as PassThrough & NodeJS.ReadStream;
  const stdout = new PassThrough() as PassThrough & NodeJS.WriteStream;
  let output = "";
  Object.assign(stdin, {
    isTTY: true,
    setRawMode: () => stdin,
    ref: () => stdin,
    unref: () => stdin,
  });
  Object.assign(stdout, { isTTY: true, columns: 100, rows: 30 });
  stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString("utf8");
  });
  return { stdin, stdout, readOutput: () => output };
}

export function testConfig(workspaceRoot: string, startup: "new" | "resume"): MagiConfig {
  return {
    workspaceRoot,
    modelProviders: [{ id: "test", provider: "custom", model: "test-model" }],
    permissions: { read: "allow", write: "prompt", shell: "prompt", network: "prompt" },
    verificationCommands: [],
    agent: { maxIterations: 5 },
    session: { startup },
    magi: { selection: { minEngines: 2, maxEngines: 3, preferFamilyDiversity: true } },
  };
}

export function scriptedAdapter(firstStep: Promise<void>, calls: string[]): PrimaryModelAdapter {
  return {
    provider: { id: "test", provider: "custom", model: "test-model" },
    generateText: async () => ({ text: "fallback" }),
    async generateStep(input) {
      calls.push(String(input.messages[0]?.content ?? ""));
      if (calls.length === 1) {
        await firstStep;
        const toolCall = {
          id: "write-1",
          name: "write",
          input: { filePath: "result.txt", content: "done" },
        };
        input.onStreamEvent?.({ type: "reasoning_start", id: "reasoning-1" });
        input.onStreamEvent?.({ type: "reasoning_delta", id: "reasoning-1", text: "Writing" });
        input.onStreamEvent?.({ type: "reasoning_end", id: "reasoning-1" });
        input.onStreamEvent?.({ type: "tool_call", toolName: "write", ...toolCall });
        return {
          text: "",
          content: [{ type: "tool-call", ...toolCall }],
          toolCalls: [toolCall],
        };
      }
      return textStep(calls.length === 2 ? "First answer" : "Queued answer", input.onStreamEvent);
    },
  };
}

export function textAdapter(text: string): PrimaryModelAdapter {
  return {
    provider: { id: "test", provider: "custom", model: "test-model" },
    generateText: async () => ({ text }),
    generateStep: async (input) => textStep(text, input.onStreamEvent),
  };
}

export function abortableAdapter(calls: string[]): PrimaryModelAdapter {
  return {
    provider: { id: "test", provider: "custom", model: "test-model" },
    generateText: async () => ({ text: "unused" }),
    async generateStep(input) {
      calls.push("started");
      return await new Promise<never>((_resolve, reject) => {
        input.signal?.addEventListener(
          "abort",
          () => reject(input.signal?.reason ?? new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      });
    },
  };
}

function textStep(
  text: string,
  onStreamEvent: Parameters<NonNullable<PrimaryModelAdapter["generateStep"]>>[0]["onStreamEvent"],
) {
  onStreamEvent?.({ type: "text_delta", text });
  return { text, content: [{ type: "text" as const, text }], toolCalls: [] };
}

export function successfulTool(call: ToolCall, calls: ToolCall[]): ToolResult {
  calls.push(call);
  return { id: call.id, name: call.name, ok: true, output: "Wrote result.txt." };
}

export function readEventPayloads(events: ReturnType<SessionStore["listEvents"]>, type: string) {
  return events.filter((event) => event.type === type).map((event) => event.payload);
}

export function sessionHasAnswers(store: SessionStore, count: number): boolean {
  const session = store.listSessions()[0];
  return Boolean(
    session &&
      store.listEvents(session.id).filter((event) => event.type === "assistant_message").length >=
        count,
  );
}

export function lifecycleDiagnostics(store: SessionStore, calls: string[], output: string): string {
  const session = store.listSessions()[0];
  const events = session ? store.listEvents(session.id) : [];
  return JSON.stringify({
    calls: calls.length,
    eventTypes: events.map((event) => event.type),
    userPayloads: readEventPayloads(events, "user_message"),
    output: output.slice(-500),
  });
}

export function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

export async function submitInput(streams: TestStreams, text: string): Promise<void> {
  streams.stdin.write(text);
  await waitFor(() => streams.readOutput().includes(text), `composer text: ${text}`);
  await settleRender();
  streams.stdin.write("\r");
}

export async function settleRender(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

export async function waitFor(
  predicate: () => boolean,
  label: string,
  diagnostics: () => string = () => "",
  timeoutMs = 3_000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs)
      throw new Error(`Timed out waiting for ${label}. Output: ${JSON.stringify(diagnostics())}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
