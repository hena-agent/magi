import type { ModelProviderSettings } from "../model-catalog.js";

export type MagiEngineFamily = string;

export type MagiEngineSelectionConfig = {
  providerIds?: string[];
  minEngines?: number;
  maxEngines?: number;
  preferFamilyDiversity?: boolean;
};

export type MagiInitiatorWeights = Record<string, number>;

export type MagiInitiatorSelection = {
  engine: MagiEngineCandidate;
  totalWeight: number;
  weights: MagiInitiatorWeights;
};

export type MagiEngineCandidate = {
  family: MagiEngineFamily;
  providerId: string;
  provider: ModelProviderSettings["provider"];
  model: string;
  ready: boolean;
  configured: boolean;
  missingEnv?: string;
};

export type MagiEnginePoolSelection = {
  candidates: MagiEngineCandidate[];
  selectedEngines: MagiEngineCandidate[];
  readyCount: number;
  requiredCount: number;
  unreadyConfiguredEngines: MagiEngineCandidate[];
  ready: boolean;
};

const defaultMinEngines = 2;
const defaultMaxEngines = 3;
const defaultInitiatorWeight = 1;
const minimumInitiatorWeight = 0.01;

export function selectMagiEngineCandidates(input: {
  providers: ModelProviderSettings[];
  env?: NodeJS.ProcessEnv;
  selection?: MagiEngineSelectionConfig;
}): MagiEnginePoolSelection {
  return selectMagiEnginePool(input);
}

export function selectMagiEnginePool(input: {
  providers: ModelProviderSettings[];
  env?: NodeJS.ProcessEnv;
  selection?: MagiEngineSelectionConfig;
}): MagiEnginePoolSelection {
  const env = input.env ?? process.env;
  const selection = normalizeSelection(input.selection);
  const configuredProviderIds = new Set(selection.providerIds ?? []);
  const candidates = input.providers
    .map((provider) => toMagiEngineCandidate(provider, env, configuredProviderIds))
    .filter((candidate): candidate is MagiEngineCandidate => candidate !== undefined)
    .filter(
      (candidate) =>
        configuredProviderIds.size === 0 || configuredProviderIds.has(candidate.providerId),
    );
  const selectedEngines = selectReadyEngines(candidates, selection);
  const unreadyConfiguredEngines = candidates.filter(
    (candidate) => candidate.configured && !candidate.ready,
  );

  return {
    candidates,
    selectedEngines,
    readyCount: selectedEngines.length,
    requiredCount: selection.minEngines,
    unreadyConfiguredEngines,
    ready: selectedEngines.length >= selection.minEngines,
  };
}

export function inferMagiEngineFamily(
  provider: Pick<ModelProviderSettings, "provider" | "id" | "model">,
): MagiEngineFamily {
  if (provider.provider === "anthropic" || /claude/i.test(provider.model)) return "anthropic";
  if (provider.provider === "google" || /gemini/i.test(provider.model)) return "google";
  if (
    provider.provider === "openai" ||
    /gpt|openai|codex/i.test(`${provider.id} ${provider.model}`)
  ) {
    return "openai";
  }
  if (provider.provider === "deepseek") return "deepseek";
  return provider.provider === "custom" ? inferCustomFamily(provider) : provider.provider;
}

export function selectMagiInitiatingEngine(input: {
  engines: MagiEngineCandidate[];
  weights?: MagiInitiatorWeights;
  random?: () => number;
}): MagiInitiatorSelection {
  const readyEngines = input.engines.filter((engine) => engine.ready);
  const [firstReadyEngine] = readyEngines;

  if (firstReadyEngine === undefined) {
    throw new Error("MAGI initiator selection requires at least one ready engine.");
  }

  const weights = normalizeInitiatorWeights(readyEngines, input.weights);
  const totalWeight = Object.values(weights).reduce((sum, weight) => sum + weight, 0);
  const random = input.random ?? Math.random;
  const target = clampRandom(random()) * totalWeight;
  let cursor = 0;
  let selectedEngine = firstReadyEngine;

  for (const engine of readyEngines) {
    selectedEngine = engine;
    cursor += weights[engine.providerId] ?? minimumInitiatorWeight;
    if (target < cursor) {
      return { engine, totalWeight, weights };
    }
  }

  return { engine: selectedEngine, totalWeight, weights };
}

function normalizeSelection(
  selection: MagiEngineSelectionConfig | undefined,
): Required<
  Pick<MagiEngineSelectionConfig, "minEngines" | "maxEngines" | "preferFamilyDiversity">
> &
  Pick<MagiEngineSelectionConfig, "providerIds"> {
  const minEngines = selection?.minEngines ?? defaultMinEngines;
  const maxEngines = Math.max(selection?.maxEngines ?? defaultMaxEngines, minEngines);

  return {
    ...(selection?.providerIds === undefined ? {} : { providerIds: selection.providerIds }),
    minEngines,
    maxEngines,
    preferFamilyDiversity: selection?.preferFamilyDiversity ?? true,
  };
}

function toMagiEngineCandidate(
  provider: ModelProviderSettings,
  env: NodeJS.ProcessEnv,
  configuredProviderIds: Set<string>,
): MagiEngineCandidate {
  const missingEnv = getMissingEnv(provider, env);

  return {
    family: inferMagiEngineFamily(provider),
    providerId: provider.id,
    provider: provider.provider,
    model: provider.model,
    ready: missingEnv === undefined,
    configured: configuredProviderIds.has(provider.id),
    ...(missingEnv === undefined ? {} : { missingEnv }),
  };
}

function selectReadyEngines(
  candidates: MagiEngineCandidate[],
  selection: ReturnType<typeof normalizeSelection>,
): MagiEngineCandidate[] {
  const ready = candidates.filter((candidate) => candidate.ready);
  const selected: MagiEngineCandidate[] = [];

  if (selection.preferFamilyDiversity) {
    const seenFamilies = new Set<string>();
    for (const candidate of ready) {
      if (seenFamilies.has(candidate.family)) continue;
      selected.push(candidate);
      seenFamilies.add(candidate.family);
      if (selected.length >= selection.maxEngines) return selected;
    }
  }

  for (const candidate of ready) {
    if (
      selected.some((selectedCandidate) => selectedCandidate.providerId === candidate.providerId)
    ) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= selection.maxEngines) return selected;
  }

  return selected;
}

function inferCustomFamily(provider: Pick<ModelProviderSettings, "id" | "model">): string {
  const text = `${provider.id} ${provider.model}`;
  if (/qwen/i.test(text)) return "qwen";
  if (/mistral|codestral/i.test(text)) return "mistral";
  if (/llama|local|ollama/i.test(text)) return "local";
  return "custom";
}

function getMissingEnv(
  provider: ModelProviderSettings,
  env: NodeJS.ProcessEnv,
): string | undefined {
  if (provider.provider === "openai" && provider.auth?.type === "oauth") return undefined;
  const envName = provider.apiKeyEnv ?? getDefaultApiKeyEnv(provider.provider);
  return envName && !env[envName] ? envName : undefined;
}

function getDefaultApiKeyEnv(provider: ModelProviderSettings["provider"]): string | undefined {
  switch (provider) {
    case "openai":
      return "OPENAI_API_KEY";
    case "deepseek":
      return "DEEPSEEK_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GOOGLE_GENERATIVE_AI_API_KEY";
    case "custom":
      return undefined;
  }
}

function normalizeInitiatorWeights(
  engines: MagiEngineCandidate[],
  weights: MagiInitiatorWeights | undefined,
): MagiInitiatorWeights {
  return Object.fromEntries(
    engines.map((engine) => {
      const configuredWeight = weights?.[engine.providerId] ?? defaultInitiatorWeight;
      const weight =
        Number.isFinite(configuredWeight) && configuredWeight > 0
          ? Math.max(configuredWeight, minimumInitiatorWeight)
          : minimumInitiatorWeight;

      return [engine.providerId, weight];
    }),
  );
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 1 - Number.EPSILON;
  return value;
}
