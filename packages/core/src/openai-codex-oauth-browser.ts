import { setAuth } from "./auth.js";
import {
  cancelPendingOAuth,
  startOAuthServer,
  stopOAuthServer,
  waitForOAuthCallback,
} from "./openai-codex-oauth-server.js";
import {
  buildAuthorizeUrl,
  generatePkce,
  tokenResponseToAuth,
} from "./openai-codex-oauth-tokens.js";
import type { OpenAICodexLoginResult } from "./openai-codex-oauth-types.js";
import { base64UrlEncode } from "./openai-codex-oauth-utils.js";

export async function loginOpenAICodexBrowser(input: {
  workspaceRoot: string;
  openUrl?: (url: string) => Promise<void> | void;
  signal?: AbortSignal;
}): Promise<OpenAICodexLoginResult> {
  const { redirectUri } = await startOAuthServer();
  try {
    input.signal?.throwIfAborted();
    const pkce = await generatePkce();
    const state = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);
    const authUrl = buildAuthorizeUrl(redirectUri, pkce, state);
    const callbackPromise = waitForOAuthCallback(pkce, state, input.signal);
    void callbackPromise.catch(() => undefined);

    await input.openUrl?.(authUrl);

    const tokens = await callbackPromise;
    input.signal?.throwIfAborted();
    const auth = tokenResponseToAuth(tokens);
    setAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai", auth });

    return auth;
  } finally {
    cancelPendingOAuth();
    stopOAuthServer();
  }
}
