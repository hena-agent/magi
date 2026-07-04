import { setTimeout as sleep } from "node:timers/promises";
import { setAuth } from "./auth.js";
import {
  OPENAI_CODEX_CLIENT_ID,
  OPENAI_CODEX_ISSUER,
  oauthPollingSafetyMarginMs,
} from "./openai-codex-oauth-constants.js";
import { exchangeCodeForTokens, tokenResponseToAuth } from "./openai-codex-oauth-tokens.js";
import type {
  DeviceTokenResponse,
  DeviceUserCodeResponse,
  OpenAICodexLoginResult,
  TokenResponse,
} from "./openai-codex-oauth-types.js";
import { userAgent } from "./openai-codex-oauth-utils.js";

export async function loginOpenAICodexHeadless(input: {
  workspaceRoot: string;
  onUserCode?: (input: { url: string; code: string }) => void;
}): Promise<OpenAICodexLoginResult> {
  const deviceData = await requestDeviceUserCode();
  const url = `${OPENAI_CODEX_ISSUER}/codex/device`;

  input.onUserCode?.({ url, code: deviceData.user_code });

  const tokens = await pollDeviceAuthorization(deviceData);
  const auth = tokenResponseToAuth(tokens);
  setAuth({ workspaceRoot: input.workspaceRoot, providerId: "openai", auth });

  return auth;
}

async function requestDeviceUserCode(): Promise<DeviceUserCodeResponse> {
  const response = await fetch(`${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ client_id: OPENAI_CODEX_CLIENT_ID }),
  });

  if (!response.ok) {
    throw new Error(`Failed to initiate device authorization: ${response.status}`);
  }

  return (await response.json()) as DeviceUserCodeResponse;
}

async function pollDeviceAuthorization(deviceData: DeviceUserCodeResponse): Promise<TokenResponse> {
  const interval = Math.max(Number.parseInt(deviceData.interval, 10) || 5, 1) * 1_000;

  while (true) {
    const response = await requestDeviceToken(deviceData);

    if (response.ok) {
      return exchangeDeviceTokenResponse(response);
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`Device authorization failed: ${response.status}`);
    }

    await sleep(interval + oauthPollingSafetyMarginMs);
  }
}

function requestDeviceToken(deviceData: DeviceUserCodeResponse): Promise<Response> {
  return fetch(`${OPENAI_CODEX_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      device_auth_id: deviceData.device_auth_id,
      user_code: deviceData.user_code,
    }),
  });
}

async function exchangeDeviceTokenResponse(response: Response): Promise<TokenResponse> {
  const data = (await response.json()) as DeviceTokenResponse;

  return exchangeCodeForTokens(
    data.authorization_code,
    `${OPENAI_CODEX_ISSUER}/deviceauth/callback`,
    {
      verifier: data.code_verifier,
      challenge: "",
    },
  );
}

function jsonHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": userAgent(),
  };
}
