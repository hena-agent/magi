import { setAuth, type OAuthAuth } from "./auth.js";
import { OPENAI_CODEX_CLIENT_ID, OPENAI_CODEX_ISSUER } from "./openai-codex-oauth-constants.js";
import type { IdTokenClaims, PkceCodes, TokenResponse } from "./openai-codex-oauth-types.js";
import { base64UrlEncode } from "./openai-codex-oauth-utils.js";

export function tokenResponseToAuth(tokens: TokenResponse, fallbackAccountId?: string): OAuthAuth {
  const accountId = extractAccountId(tokens) ?? fallbackAccountId;

  return {
    type: "oauth",
    refresh: tokens.refresh_token,
    access: tokens.access_token,
    expires: Date.now() + (tokens.expires_in ?? 3_600) * 1_000,
    ...(accountId ? { accountId } : {}),
  };
}

export async function generatePkce(): Promise<PkceCodes> {
  const verifier = randomPkceVerifier();
  const challenge = base64UrlEncode(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );

  return { verifier, challenge };
}

export function buildAuthorizeUrl(redirectUri: string, pkce: PkceCodes, state: string): string {
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

export async function exchangeCodeForTokens(
  code: string,
  redirectUri: string,
  pkce: PkceCodes,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: OPENAI_CODEX_CLIENT_ID,
    code_verifier: pkce.verifier,
  });

  return postTokenRequest(body, "Token exchange failed");
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

function randomPkceVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

  return Array.from(crypto.getRandomValues(new Uint8Array(43)))
    .map((value) => chars[value % chars.length])
    .join("");
}

async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: OPENAI_CODEX_CLIENT_ID,
  });

  return postTokenRequest(body, "Token refresh failed");
}

async function postTokenRequest(
  body: URLSearchParams,
  errorPrefix: string,
): Promise<TokenResponse> {
  const response = await fetch(`${OPENAI_CODEX_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`${errorPrefix}: ${response.status}`);
  }

  return (await response.json()) as TokenResponse;
}

function extractAccountId(tokens: TokenResponse): string | undefined {
  return extractIdTokenAccountId(tokens) ?? extractAccessTokenAccountId(tokens);
}

function extractIdTokenAccountId(tokens: TokenResponse): string | undefined {
  return tokens.id_token ? extractAccountIdFromClaims(parseJwtClaims(tokens.id_token)) : undefined;
}

function extractAccessTokenAccountId(tokens: TokenResponse): string | undefined {
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
