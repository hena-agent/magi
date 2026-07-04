import { getAuth, isOAuthAuth, type OAuthAuth } from "./auth.js";
import { OPENAI_CODEX_API_ENDPOINT } from "./openai-codex-oauth-constants.js";
import { refreshOpenAICodexAuth } from "./openai-codex-oauth-tokens.js";
import { copyHeadersWithoutAuthorization, userAgent } from "./openai-codex-oauth-utils.js";

export function createOpenAICodexOAuthFetch(input: {
  workspaceRoot: string;
  sessionId?: string;
}): typeof fetch {
  let refreshPromise: Promise<OAuthAuth> | undefined;

  return async (requestInput, init) => {
    const auth = await resolveAuth(input.workspaceRoot, refreshPromise, (promise) => {
      refreshPromise = promise;
    });
    const headers = authHeaders(auth, init?.headers, input.sessionId);

    return fetch(resolveCodexUrl(requestInput), { ...init, headers });
  };
}

async function resolveAuth(
  workspaceRoot: string,
  refreshPromise: Promise<OAuthAuth> | undefined,
  setRefreshPromise: (promise: Promise<OAuthAuth> | undefined) => void,
): Promise<OAuthAuth> {
  const current = getOpenAICodexAuth(workspaceRoot);

  if (current.access && current.expires >= Date.now()) {
    return current;
  }

  const promise = refreshPromise ?? queueRefresh(workspaceRoot, current, setRefreshPromise);
  return promise;
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
  setRefreshPromise: (promise: Promise<OAuthAuth> | undefined) => void,
): Promise<OAuthAuth> {
  const promise = refreshOpenAICodexAuth({ workspaceRoot, auth }).finally(() => {
    setRefreshPromise(undefined);
  });

  setRefreshPromise(promise);
  return promise;
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
