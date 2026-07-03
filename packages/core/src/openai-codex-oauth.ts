import { createServer } from "node:http";
import os from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { getAuth, isOAuthAuth, setAuth, type OAuthAuth } from "./auth.js";

export const OPENAI_CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const OPENAI_CODEX_ISSUER = "https://auth.openai.com";
export const OPENAI_CODEX_API_ENDPOINT = "https://chatgpt.com/backend-api/codex/responses";
export const OPENAI_CODEX_OAUTH_PORT = 1455;

const oauthPollingSafetyMarginMs = 3_000;

type PkceCodes = {
  verifier: string;
  challenge: string;
};

export type OpenAICodexLoginResult = {
  access: string;
  refresh: string;
  expires: number;
  accountId?: string;
};

type TokenResponse = {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
};

type DeviceUserCodeResponse = {
  device_auth_id: string;
  user_code: string;
  interval: string;
};

type DeviceTokenResponse = {
  authorization_code: string;
  code_verifier: string;
};

type IdTokenClaims = {
  chatgpt_account_id?: string;
  organizations?: Array<{ id: string }>;
  email?: string;
  "https://api.openai.com/auth"?: {
    chatgpt_account_id?: string;
  };
};

type PendingOAuth = {
  pkce: PkceCodes;
  state: string;
  resolve: (tokens: TokenResponse) => void;
  reject: (error: Error) => void;
};

let oauthServer: ReturnType<typeof createServer> | undefined;
let pendingOAuth: PendingOAuth | undefined;

export function isOpenAICodexOAuthModel(model: string): boolean {
  if (
    model === "gpt-5.5" ||
    model === "gpt-5.3-codex-spark" ||
    model === "gpt-5.4" ||
    model === "gpt-5.4-mini"
  ) {
    return true;
  }

  if (model === "gpt-5.5-pro") {
    return false;
  }

  const match = model.match(/^gpt-(\d+\.\d+)/);

  return match ? Number.parseFloat(match[1] ?? "0") > 5.4 : false;
}

export async function loginOpenAICodexBrowser(input: {
  workspaceRoot: string;
  openUrl?: (url: string) => Promise<void> | void;
}): Promise<OpenAICodexLoginResult> {
  const { redirectUri } = await startOAuthServer();
  const pkce = await generatePkce();
  const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);
  const callbackPromise = waitForOAuthCallback(pkce, state);

  await input.openUrl?.(authUrl);

  let tokens: TokenResponse;

  try {
    tokens = await callbackPromise;
  } finally {
    stopOAuthServer();
  }

  const auth = tokenResponseToAuth(tokens);
  setAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai", auth });

  return auth;
}

export async function loginOpenAICodexHeadless(input: {
  workspaceRoot: string;
  onUserCode?: (input: { url: string; code: string }) => void;
}): Promise<OpenAICodexLoginResult> {
  const deviceResponse = await fetch(`${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": userAgent(),
    },
    body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
  });

  if (!deviceResponse.ok) {
    throw new Error(`Failed to initiate device authorization: ${deviceResponse.status}`);
  }

  const deviceData = (await deviceResponse.json()) as DeviceUserCodeResponse;
  const interval = Math.max(Number.parseInt(deviceData.interval, 10) || 5, 1) * 1_000;
  const url = `${OPENAI_CODEX_ISSUER}/codex/device`;

  input.onUserCode?.({ url, code: deviceData.user_code });

  while (true) {
    const response = await fetch(`${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent(),
      },
      body: JSON.stringify({
        device_auth_id: deviceData.device_auth_id,
        user_code: deviceData.user_code,
      }),
    });

    if (response.ok) {
      const data = (await response.json()) as DeviceTokenResponse;
      const tokens = await exchangeCodeForTokens(
        data.authorization_code,
        `${OPENAI_CODEX_ISSUER}/deviceauth/callback`,
        {
          verifier: data.code_verifier,
          challenge: "",
        },
      );
      const auth = tokenResponseToAuth(tokens);
      setAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai", auth });

      return auth;
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`Device authorization failed: ${response.status}`);
    }

    await sleep(interval + oauthPollingSafetyMarginMs);
  }
}

export function createOpenAICodexOAuthFetch(input: {
  workspaceRoot: string;
  sessionId?: string;
}): typeof fetch {
  let refreshPromise: Promise<OAuthAuth> | undefined;

  return async (requestInput, init) => {
    const current = getAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai" });

    if (!isOAuthAuth(current)) {
      throw new Error("OpenAI OAuth auth is missing. Run /auth login openai.");
    }

    let auth = current;

    if (!auth.access || auth.expires < Date.now()) {
      refreshPromise ??= refreshOpenAICodexAuth({
        workspaceRoot: input.workspaceRoot,
        auth,
      }).finally(() => {
        refreshPromise = undefined;
      });
      auth = await refreshPromise;
    }

    const headers = copyHeadersWithoutAuthorization(init?.headers);
    headers.set("authorization", `Bearer ${auth.access}`);
    headers.set("originator", "magi");
    headers.set("User-Agent", userAgent());

    if (input.sessionId) {
      headers.set("session-id", input.sessionId);
    }

    if (auth.accountId) {
      headers.set("ChatGPT-Account-Id", auth.accountId);
    }

    const parsed =
      requestInput instanceof URL
        ? requestInput
        : new URL(typeof requestInput === "string" ? requestInput : requestInput.url);
    const url =
      parsed.pathname.includes("/v1/responses") || parsed.pathname.includes("/chat/completions")
        ? new URL(OPENAI_CODEX_API_ENDPOINT)
        : parsed;

    return fetch(url, { ...init, headers });
  };
}

export async function refreshOpenAICodexAuth(input: {
  workspaceRoot: string;
  auth: OAuthAuth;
}): Promise<OAuthAuth> {
  const tokens = await refreshAccessToken(input.auth.refresh);
  const accountId = extractAccountId(tokens) ?? input.auth.accountId;
  const auth = tokenResponseToAuth(tokens, accountId);

  setAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai", auth });

  return auth;
}

function tokenResponseToAuth(tokens: TokenResponse, fallbackAccountId?: string): OAuthAuth {
  const accountId = extractAccountId(tokens) ?? fallbackAccountId;

  return {
    type: "oauth",
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3_600) * 1_000,
    ...(accountId ? { accountId } : {}),
  };
}

async function generatePkce(): Promise<PkceCodes> {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const verifier = Array.from(crypto.getRandomValues(new Uint8Array(43)))
    .map((value) => chars[value % chars.length])
    .join("");
  const challenge = base64UrlEncode(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );

  return { verifier, challenge };
}

function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: OPENAI_CODEX_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access",
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    state,
    originator: "opencode",
  });

  return `${OPENAI_CODEX_ISSUER}/oauth/authorize?${params.toString()}`;
}

async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<TokenResponse> {
  const response = await fetch(`${OPENAI_CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: OPENAI_CODEX_CLIENT_ID,
      code_verifier: pkce.verifier,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const response = await fetch(`${OPENAI_CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: OPENAI_CODEX_CLIENT_ID,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(`Token refresh failed: ${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

function startOAuthServer(): Promise<{ port: number; redirectUri: string }> {
  if (oauthServer) {
    return Promise.resolve({
      port: OPENAI_CODEX_OAUTH_PORT,
      redirectUri: `http://localhost:${OPENAI_CODEX_OAUTH_PORT}/auth/callback`,
    });
  }

  oauthServer = createServer((req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${OPENAI_CODEX_OAUTH_PORT}`);

    if (url.pathname === "/auth/callback") {
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      const error = url.searchParams.get("error");
      const errorDescription = url.searchParams.get("error_description");

      if (error) {
        rejectPendingOAuth(errorDescription || error, res);
        return;
      }

      if (!code) {
        rejectPendingOAuth("Missing authorization code", res, 400);
        return;
      }

      if (!pendingOAuth || state !== pendingOAuth.state) {
        rejectPendingOAuth("Invalid state - potential CSRF attack", res, 400);
        return;
      }

      const current = pendingOAuth;
      pendingOAuth = undefined;
      exchangeCodeForTokens(
        code,
        `http://localhost:${OPENAI_CODEX_OAUTH_PORT}/auth/callback`,
        current.pkce,
      )
        .then((tokens) => current.resolve(tokens))
        .catch((error_: unknown) =>
          current.reject(error_ instanceof Error ? error_ : new Error(String(error_))),
        );
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(successHtml());
      return;
    }

    if (url.pathname === "/cancel") {
      pendingOAuth?.reject(new Error("Login cancelled"));
      pendingOAuth = undefined;
      res.writeHead(200);
      res.end("Login cancelled");
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  return new Promise((resolve, reject) => {
    oauthServer?.listen(OPENAI_CODEX_OAUTH_PORT, () => {
      resolve({
        port: OPENAI_CODEX_OAUTH_PORT,
        redirectUri: `http://localhost:${OPENAI_CODEX_OAUTH_PORT}/auth/callback`,
      });
    });
    oauthServer?.on("error", reject);
  });
}

function stopOAuthServer(): void {
  if (oauthServer) {
    oauthServer.close(() => {});
    oauthServer = undefined;
  }
}

function waitForOAuthCallback(pkce: PkceCodes, state: string): Promise<TokenResponse> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        if (pendingOAuth) {
          pendingOAuth = undefined;
          reject(new Error("OAuth callback timeout - authorization took too long"));
        }
      },
      5 * 60 * 1_000,
    );

    pendingOAuth = {
      pkce,
      state,
      resolve: (tokens) => {
        clearTimeout(timeout);
        resolve(tokens);
      },
      reject: (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    };
  });
}

function rejectPendingOAuth(
  message: string,
  res: {
    writeHead: (status: number, headers?: Record<string, string>) => void;
    end: (body: string) => void;
  },
  status = 200,
): void {
  pendingOAuth?.reject(new Error(message));
  pendingOAuth = undefined;
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(errorHtml(message));
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  if (tokens.id_token) {
    const accountId = extractAccountIdFromClaims(parseJwtClaims(tokens.id_token));

    if (accountId) {
      return accountId;
    }
  }

  return tokens.access_token
    ? extractAccountIdFromClaims(parseJwtClaims(tokens.access_token))
    : undefined;
}

function parseJwtClaims(token: string | undefined): IdTokenClaims | undefined {
  const parts = token?.split(".");

  if (parts?.length !== 3 || !parts[1]) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()) as IdTokenClaims;
  } catch {
    return undefined;
  }
}

function extractAccountIdFromClaims(claims: IdTokenClaims | undefined): string | undefined {
  return (
    claims?.chatgpt_account_id ??
    claims?.["https://api.openai.com/auth"]?.chatgpt_account_id ??
    claims?.organizations?.[0]?.id
  );
}

function copyHeadersWithoutAuthorization(
  headersInit: ConstructorParameters<typeof Headers>[0] | undefined,
): Headers {
  const headers = new Headers(headersInit);
  headers.delete("authorization");
  headers.delete("Authorization");

  return headers;
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64url");
}

function userAgent(): string {
  return `magi/0.0.0 (${os.platform()} ${os.release()}; ${os.arch()})`;
}

function successHtml(): string {
  return "<!doctype html><html><body><h1>Authorization Successful</h1><p>You can close this window and return to MAGI.</p><script>setTimeout(() => window.close(), 2000)</script></body></html>";
}

function errorHtml(error: string): string {
  return `<!doctype html><html><body><h1>Authorization Failed</h1><pre>${escapeHtml(error)}</pre></body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
