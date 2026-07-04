import { setAuth } from "./auth.js";
import {
  buildAuthorizeUrl,
  generatePkce,
  tokenResponseToAuth,
} from "./openai-codex-oauth-tokens.js";
import type { OpenAICodexLoginResult, TokenResponse } from "./openai-codex-oauth-types.js";
import { base64UrlEncode } from "./openai-codex-oauth-utils.js";
import {
  startOAuthServer,
  stopOAuthServer,
  waitForOAuthCallback,
} from "./openai-codex-oauth-server.js";

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

  const tokens = await resolveCallback(callbackPromise);
  const auth = tokenResponseToAuth(tokens);
  setAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai", auth });

  return auth;
}

async function resolveCallback(callbackPromise: Promise<TokenResponse>): Promise<TokenResponse> {
  try {
    return await callbackPromise;
  } finally {
    stopOAuthServer();
  }
}
