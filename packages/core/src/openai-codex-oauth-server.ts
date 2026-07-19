import { createServer, type ServerResponse } from "node:http";
import { OPENAI_CODEX_OAUTH_PORT } from "./openai-codex-oauth-constants.js";
import { exchangeCodeForTokens } from "./openai-codex-oauth-tokens.js";
import type { PkceCodes, TokenResponse } from "./openai-codex-oauth-types.js";
import { errorHtml, successHtml } from "./openai-codex-oauth-utils.js";

type PendingOAuth = {
  pkce: PkceCodes;
  state: string;
  resolve: (tokens: TokenResponse) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
};

let oauthServer: ReturnType<typeof createServer> | undefined;
let pendingOAuth: PendingOAuth | undefined;

export function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return Promise.resolve(oauthServerLocation());
  }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OPENAI_CODEX_OAUTH_PORT}`);
    handleOAuthRequest(url, res);
  });

  return listenOAuthServer();
}

export function stopOAuthServer(): void {
  if (oauthServer) {
    oauthServer.close(() => {});
    oauthServer = undefined;
  }
}

export function cancelPendingOAuth(error = new Error("Login cancelled")): void {
  const current = pendingOAuth;
  pendingOAuth = undefined;
  current?.reject(error);
}

export function waitForOAuthCallback(
  pkce: PkceCodes,
  state: string,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      pendingOAuth = undefined;
      cleanup();
      reject(new DOMException("Operation aborted", "AbortError"));
    };
    const timeout = setTimeout(
      () => {
        cleanup();
        rejectTimedOutOAuth(reject);
      },
      5 * 60 * 1_000,
    );

    pendingOAuth = {
      pkce,
      state,
      signal,
      resolve: (tokens) => {
        cleanup();
        resolve(tokens);
      },
      reject: (error) => {
        cleanup();
        reject(error);
      },
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function handleOAuthRequest(url: URL, res: ServerResponse): void {
  if (url.pathname === "/auth/callback") {
    handleOAuthCallback(url, res);
    return;
  }

  if (url.pathname === "/cancel") {
    cancelOAuth(res);
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

function handleOAuthCallback(url: URL, res: ServerResponse): void {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    rejectPendingOAuth(url.searchParams.get("error_description") || error, res);
    return;
  }

  if (!code || !pendingOAuth || state !== pendingOAuth.state) {
    rejectInvalidCallback(code, res);
    return;
  }

  resolvePendingOAuth(code);
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(successHtml());
}

function rejectInvalidCallback(code: string | null, res: ServerResponse): void {
  const message = code ? "Invalid state - potential CSRF attack" : "Missing authorization code";
  rejectPendingOAuth(message, res, 400);
}

function resolvePendingOAuth(code: string): void {
  const current = pendingOAuth;
  pendingOAuth = undefined;

  if (!current) {
    return;
  }

  exchangeCodeForTokens(code, oauthServerLocation().redirectUri, current.pkce, current.signal)
    .then((tokens) => current.resolve(tokens))
    .catch((error: unknown) => current.reject(normalizeError(error)));
}

function cancelOAuth(res: ServerResponse): void {
  cancelPendingOAuth();
  res.writeHead(200);
  res.end("Login cancelled");
}

function rejectTimedOutOAuth(reject: (error: Error) => void): void {
  if (pendingOAuth) {
    pendingOAuth = undefined;
    reject(new Error("OAuth callback timeout - authorization took too long"));
  }
}

function rejectPendingOAuth(message: string, res: ServerResponse, status = 200): void {
  pendingOAuth?.reject(new Error(message));
  pendingOAuth = undefined;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(errorHtml(message));
}

function listenOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    const server = oauthServer;
    if (!server) {
      reject(new Error("OAuth callback server is unavailable"));
      return;
    }
    const onError = (error: Error) => {
      if (oauthServer === server) oauthServer = undefined;
      reject(error);
    };
    server.once("error", onError);
    server.listen(OPENAI_CODEX_OAUTH_PORT, () => {
      server.removeListener("error", onError);
      resolve(oauthServerLocation());
    });
  });
}

function oauthServerLocation(): { port: number; redirectUri: string } {
  return {
    port: OPENAI_CODEX_OAUTH_PORT,
    redirectUri: `http://localhost:${OPENAI_CODEX_OAUTH_PORT}/auth/callback`,
  };
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
