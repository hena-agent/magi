import { listEffectiveModelProviders, type ModelProviderSettings } from "./model-catalog.js";
import type { SessionEvent } from "./session.js";

export type ModelProviderSummary = {
  id: string;
  provider: string;
  model: string;
  auth?: { type: string };
};

export type ModelSelection = {
  providerId: string;
  model: string;
};

export function getDefaultModelSelection(input: {
  modelProviders: ModelProviderSummary[];
}): ModelSelection | undefined {
  const provider = input.modelProviders[0];

  return provider ? { providerId: provider.id, model: provider.model } : undefined;
}

export function getEffectiveModelProviderSummaries(input: {
  configProviders: ModelProviderSettings[];
  workspaceRoot?: string;
}): ModelProviderSummary[] {
  return listEffectiveModelProviders(input).map((provider) => ({
    id: provider.id,
    provider: provider.provider,
    model: provider.model,
    ...(provider.auth === undefined ? {} : { auth: provider.auth }),
  }));
}

export function getLatestModelSelection(input: {
  events: SessionEvent[];
  modelProviders: ModelProviderSummary[];
}): ModelSelection | undefined {
  const latestSwitch = [...input.events].reverse().find((event) => event.type === "model_switch");

  if (latestSwitch) {
    const payload = latestSwitch.payload as { providerId?: unknown; model?: unknown };

    if (typeof payload.providerId === "string" && typeof payload.model === "string") {
      return { providerId: payload.providerId, model: payload.model };
    }
  }

  return getDefaultModelSelection({ modelProviders: input.modelProviders });
}

export function getModelProvider(input: {
  providerId: string;
  modelProviders: ModelProviderSummary[];
}): ModelProviderSummary | undefined {
  return input.modelProviders.find((provider) => provider.id === input.providerId);
}
