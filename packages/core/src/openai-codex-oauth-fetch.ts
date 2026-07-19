import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getAuth, isOAuthAuth, type OAuthAuth } from "./auth.js";
import { OPENAI_CODEX_API_ENDPOINT } from "./openai-codex-oauth-constants.js";
import { refreshOpenAICodexAuth } from "./openai-codex-oauth-tokens.js";
import { copyHeadersWithoutAuthorization, userAgent } from "./openai-codex-oauth-utils.js";

export const RAW_MODEL_LOGGING_ENV = "MAGI_RAW_MODEL_LOGGING";

type RefreshOperation = {
  controller: AbortController;
  promise: Promise<OAuthAuth>;
  waiters: number;
};

export function isRawModelLoggingEnabled(): boolean {
  return process.env[RAW_MODEL_LOGGING_ENV] === "1";
}

export function createOpenAICodexOAuthFetch(input: {
  workspaceRoot: string;
  sessionId?: string;
}): typeof fetch {
  let refreshOperation: RefreshOperation | undefined;

  return async (requestInput, init) => {
    const auth = await resolveAuth(
      input.workspaceRoot,
      refreshOperation,
      (operation) => {
        refreshOperation = operation;
      },
      (operation) => {
        if (refreshOperation === operation) refreshOperation = undefined;
      },
      init?.signal ?? undefined,
    );
    const headers = authHeaders(auth, init?.headers, input.sessionId);
    await appendOpenAIRequestLog(input.workspaceRoot, requestInput, init).catch(() => undefined);

    return fetch(resolveCodexUrl(requestInput), { ...init, headers });
  };
}

async function appendOpenAIRequestLog(
  workspaceRoot: string,
  requestInput: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
): Promise<void> {
  if (!isRawModelLoggingEnabled()) return;

  const url =
    requestInput instanceof URL
      ? requestInput
      : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);
  if (!isOpenAIResponsesUrl(url)) return;

  const directory = join(workspaceRoot, ".magi", "debug");
  await mkdir(directory, { recursive: true });
  await appendFile(
    join(directory, "model-raw.ndjson"),
    `${JSON.stringify({
      createdAt: new Date().toISOString(),
      providerId: "openai",
      provider: "openai",
      phase: "oauth-request",
      payload: {
        url: url.toString(),
        body: typeof init?.body === "string" ? parseJsonBody(init.body) : "<non-string body>",
      },
    })}\n`,
  );
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

async function resolveAuth(
  workspaceRoot: string,
  refreshOperation: RefreshOperation | undefined,
  setRefreshOperation: (operation: RefreshOperation | undefined) => void,
  clearRefreshOperation: (operation: RefreshOperation) => void,
  signal?: AbortSignal,
): Promise<OAuthAuth> {
  const current = getOpenAICodexAuth(workspaceRoot);

  if (current.access && current.expires >= Date.now()) {
    return current;
  }

  const operation =
    refreshOperation && !refreshOperation.controller.signal.aborted
      ? refreshOperation
      : queueRefresh(workspaceRoot, current, setRefreshOperation, clearRefreshOperation);
  return waitForRefresh(operation, signal);
}

function getOpenAICodexAuth(workspaceRoot: string): OAuthAuth {
  const current = getAuth({ workspaceRoot, providerId: "openai" });

  if (!isOAuthAuth(current)) {
    throw new Error("OpenAI OAuth auth is missing. Run /auth login openai.");
  }

  return current;
}

function queueRefresh(
  workspaceRoot: string,
  auth: OAuthAuth,
  setRefreshOperation: (operation: RefreshOperation | undefined) => void,
  clearRefreshOperation: (operation: RefreshOperation) => void,
): RefreshOperation {
  const controller = new AbortController();
  const operation = {
    controller,
    promise: refreshOpenAICodexAuth({ workspaceRoot, auth, signal: controller.signal }),
    waiters: 0,
  };
  setRefreshOperation(operation);
  void operation.promise.then(
    () => clearRefreshOperation(operation),
    () => clearRefreshOperation(operation),
  );
  return operation;
}

async function waitForRefresh(
  operation: RefreshOperation,
  signal?: AbortSignal,
): Promise<OAuthAuth> {
  operation.waiters += 1;
  try {
    signal?.throwIfAborted();
    if (!signal) return await operation.promise;
    return await new Promise<OAuthAuth>((resolve, reject) => {
      const onAbort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const cleanup = () => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      void operation.promise.then(
        (auth) => {
          cleanup();
          resolve(auth);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
      if (signal.aborted) onAbort();
    });
  } finally {
    operation.waiters -= 1;
    if (signal?.aborted && operation.waiters === 0) operation.controller.abort(signal.reason);
  }
}

function authHeaders(
  auth: OAuthAuth,
  headersInit: ConstructorParameters<typeof Headers>[0] | undefined,
  sessionId: string | undefined,
): Headers {
  const headers = copyHeadersWithoutAuthorization(headersInit);
  headers.set("authorization", `Bearer ${auth.access}`);
  headers.set("originator", "magi");
  headers.set("User-Agent", userAgent());

  addOptionalHeader(headers, "session-id", sessionId);
  addOptionalHeader(headers, "ChatGPT-Account-Id", auth.accountId);

  return headers;
}

function addOptionalHeader(headers: Headers, name: string, value: string | undefined): void {
  if (value) {
    headers.set(name, value);
  }
}

function resolveCodexUrl(requestInput: Parameters<typeof fetch>[0]): URL {
  const parsed =
    requestInput instanceof URL
      ? requestInput
      : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);

  return isOpenAIResponsesUrl(parsed) ? new URL(OPENAI_CODEX_API_ENDPOINT) : parsed;
}

function isOpenAIResponsesUrl(url: URL): boolean {
  return url.pathname.includes("/v1/responses") || url.pathname.includes("/chat/completions");
}
