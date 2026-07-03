import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";

export type OAuthAuth = {
  type: "oauth";
  refresh: string;
  access: string;
  expires: number;
  accountId?: string;
  enterpriseUrl?: string;
};

export type ApiAuth = {
  type: "api";
  key: string;
  metadata?: Record<string, string>;
};

export type WellKnownAuth = {
  type: "wellknown";
  key: string;
  token: string;
};

export type AuthInfo = OAuthAuth | ApiAuth | WellKnownAuth;

export type AuthStore = Record<string, AuthInfo>;

export function getAuthFilePath(workspaceRoot: string): string {
  return join(workspaceRoot, ".magi", "auth.json");
}

export function loadAuthStore(input: { workspaceRoot: string }): AuthStore {
  const envStore = loadAuthStoreFromEnv();

  if (envStore) {
    return envStore;
  }

  const authPath = getAuthFilePath(input.workspaceRoot);

  if (!existsSync(authPath)) {
    return {};
  }

  return readAuthStoreJson(readFileSync(authPath, "utf8"));
}

export function getAuth(input: {
  workspaceRoot: string;
  providerId: string;
}): AuthInfo | undefined {
  return loadAuthStore({ workspaceRoot: input.workspaceRoot })[normalizeAuthKey(input.providerId)];
}

export function setAuth(input: {
  workspaceRoot: string;
  providerId: string;
  auth: AuthInfo;
}): void {
  const key = normalizeAuthKey(input.providerId);
  const store = loadAuthStore({ workspaceRoot: input.workspaceRoot });
  const nextStore = { ...store, [key]: input.auth };
  const authPath = getAuthFilePath(input.workspaceRoot);

  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(nextStore, null, 2)}\n`, { mode: 0o600 });
}

export function removeAuth(input: { workspaceRoot: string; providerId: string }): void {
  const key = normalizeAuthKey(input.providerId);
  const store = loadAuthStore({ workspaceRoot: input.workspaceRoot });

  delete store[key];
  delete store[`${key}/`];

  const authPath = getAuthFilePath(input.workspaceRoot);
  mkdirSync(dirname(authPath), { recursive: true });
  writeFileSync(authPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
}

export function isOAuthAuth(value: AuthInfo | undefined): value is OAuthAuth {
  return value?.type === "oauth";
}

function normalizeAuthKey(key: string): string {
  return key.replace(/\/+$/, "");
}

function loadAuthStoreFromEnv(): AuthStore | undefined {
  const content = process.env.MAGI_AUTH_CONTENT ?? process.env.OPENCODE_AUTH_CONTENT;

  if (!content) {
    return undefined;
  }

  try {
    return readAuthStoreJson(content);
  } catch {
    return {};
  }
}

function readAuthStoreJson(content: string): AuthStore {
  const parsed = JSON.parse(content) as unknown;

  if (!isRecord(parsed)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, value]) => {
      const auth = readAuthInfo(value);

      return auth ? [[normalizeAuthKey(key), auth]] : [];
    }),
  );
}

function readAuthInfo(value: unknown): AuthInfo | undefined {
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }

  if (
    value.type === "oauth" &&
    typeof value.refresh === "string" &&
    typeof value.access === "string" &&
    typeof value.expires === "number" &&
    Number.isFinite(value.expires) &&
    value.expires >= 0
  ) {
    return {
      type: "oauth",
      refresh: value.refresh,
      access: value.access,
      expires: value.expires,
      ...(typeof value.accountId === "string" ? { accountId: value.accountId } : {}),
      ...(typeof value.enterpriseUrl === "string" ? { enterpriseUrl: value.enterpriseUrl } : {}),
    };
  }

  if (value.type === "api" && typeof value.key === "string") {
    return {
      type: "api",
      key: value.key,
      ...(isStringRecord(value.metadata) ? { metadata: value.metadata } : {}),
    };
  }

  if (
    value.type === "wellknown" &&
    typeof value.key === "string" &&
    typeof value.token === "string"
  ) {
    return { type: "wellknown", key: value.key, token: value.token };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}
