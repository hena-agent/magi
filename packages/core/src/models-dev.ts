import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ModelsDevProvider = {
  id: string;
  name: string;
  env: string[];
  api?: string;
  npm?: string;
  models: Record<string, ModelsDevModel>;
};

export type ModelsDevModel = {
  id: string;
  name: string;
  family?: string;
  release_date: string;
  attachment: boolean;
  reasoning: boolean;
  temperature: boolean;
  tool_call: boolean;
  limit: {
    context: number;
    input?: number;
    output: number;
  };
  modalities?: {
    input: string[];
    output: string[];
  };
  status?: "alpha" | "beta" | "deprecated" | "active";
  provider?: {
    npm?: string;
    api?: string;
  };
  experimental?: {
    modes?: Record<
      string,
      {
        provider?: {
          headers?: Record<string, string>;
          body?: Record<string, unknown>;
        };
      }
    >;
  };
};

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

export type LoadModelsDevCatalogInput = {
  workspaceRoot: string;
  sourceUrl?: string;
  cachePath?: string;
  maxAgeMs?: number;
  fetch?: typeof fetch;
};

const defaultSourceUrl = "https://models.dev/api.json";
const defaultMaxAgeMs = 24 * 60 * 60 * 1000;

export async function loadModelsDevCatalog(
  input: LoadModelsDevCatalogInput,
): Promise<ModelsDevCatalog> {
  const cachePath = getModelsDevCachePath(input);
  const cached = readCachedCatalog(cachePath, input.maxAgeMs ?? defaultMaxAgeMs);

  if (cached.fresh && cached.catalog) return cached.catalog;

  try {
    const catalog = await fetchModelsDevCatalog({
      url: input.sourceUrl ?? defaultSourceUrl,
      fetch: input.fetch ?? fetch,
    });
    writeCatalogCache(cachePath, catalog);
    return catalog;
  } catch (error) {
    if (cached.catalog) return cached.catalog;
    throw new Error(
      `Failed to load Models.dev catalog: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function getModelsDevCachePath(input: {
  workspaceRoot: string;
  cachePath?: string;
}): string {
  return input.cachePath ?? join(input.workspaceRoot, ".magi", "cache", "models-dev.json");
}

async function fetchModelsDevCatalog(input: {
  url: string;
  fetch: typeof fetch;
}): Promise<ModelsDevCatalog> {
  const response = await input.fetch(input.url, {
    headers: { "user-agent": "magi/models-dev" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return validateModelsDevCatalog(await response.json());
}

function readCachedCatalog(
  cachePath: string,
  maxAgeMs: number,
): { catalog?: ModelsDevCatalog; fresh: boolean } {
  if (!existsSync(cachePath)) return { fresh: false };

  try {
    const parsed = JSON.parse(readFileSync(cachePath, "utf8")) as unknown;
    const catalog = validateModelsDevCatalog(parsed);
    const fresh = Date.now() - getCacheTimestampMs(cachePath) <= maxAgeMs;
    return { catalog, fresh };
  } catch {
    return { fresh: false };
  }
}

function getCacheTimestampMs(cachePath: string): number {
  try {
    return new Date(readFileSync(`${cachePath}.timestamp`, "utf8").trim()).getTime();
  } catch {
    return 0;
  }
}

function writeCatalogCache(cachePath: string, catalog: ModelsDevCatalog): void {
  mkdirSync(dirname(cachePath), { recursive: true });
  const tempPath = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(catalog, null, 2)}\n`);
  renameSync(tempPath, cachePath);
  writeFileSync(`${cachePath}.timestamp`, `${new Date().toISOString()}\n`);
}

function validateModelsDevCatalog(value: unknown): ModelsDevCatalog {
  if (!isObject(value)) throw new Error("Models.dev catalog must be an object.");

  const catalog: ModelsDevCatalog = {};
  for (const [providerId, providerValue] of Object.entries(value)) {
    if (!isObject(providerValue)) continue;
    const provider = readProvider(providerValue, providerId);
    if (provider) catalog[providerId] = provider;
  }

  return catalog;
}

function readProvider(
  value: Record<string, unknown>,
  fallbackId: string,
): ModelsDevProvider | undefined {
  const id = readString(value.id) ?? fallbackId;
  const name = readString(value.name) ?? id;
  const env = Array.isArray(value.env) ? value.env.filter(isString) : [];
  const modelsValue = value.models;

  if (!isObject(modelsValue)) return undefined;

  const models: Record<string, ModelsDevModel> = {};
  for (const [modelId, modelValue] of Object.entries(modelsValue)) {
    if (!isObject(modelValue)) continue;
    const model = readModel(modelValue, modelId);
    if (model) models[modelId] = model;
  }

  return {
    id,
    name,
    env,
    ...(readString(value.api) === undefined ? {} : { api: readString(value.api) }),
    ...(readString(value.npm) === undefined ? {} : { npm: readString(value.npm) }),
    models,
  };
}

function readModel(value: Record<string, unknown>, fallbackId: string): ModelsDevModel | undefined {
  const id = readString(value.id) ?? fallbackId;
  const name = readString(value.name) ?? id;
  const limit = isObject(value.limit) ? value.limit : undefined;

  if (!limit || typeof limit.context !== "number" || typeof limit.output !== "number") {
    return undefined;
  }

  return {
    id,
    name,
    ...(readString(value.family) === undefined ? {} : { family: readString(value.family) }),
    release_date: readString(value.release_date) ?? "",
    attachment: value.attachment === true,
    reasoning: value.reasoning === true,
    temperature: value.temperature === true,
    tool_call: value.tool_call === true,
    limit: {
      context: limit.context,
      ...(typeof limit.input === "number" ? { input: limit.input } : {}),
      output: limit.output,
    },
    ...(readModelStatus(value.status) === undefined
      ? {}
      : { status: readModelStatus(value.status) }),
    ...(readModelProvider(value.provider) === undefined
      ? {}
      : { provider: readModelProvider(value.provider) }),
  };
}

function readModelProvider(value: unknown): ModelsDevModel["provider"] | undefined {
  if (!isObject(value)) return undefined;
  const npm = readString(value.npm);
  const api = readString(value.api);
  if (!npm && !api) return undefined;
  return { ...(npm === undefined ? {} : { npm }), ...(api === undefined ? {} : { api }) };
}

function readModelStatus(value: unknown): ModelsDevModel["status"] | undefined {
  return value === "alpha" || value === "beta" || value === "deprecated" || value === "active"
    ? value
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
