import { describe, expect, it } from "vitest";
import {
  getDefaultModelSelection,
  getLatestModelSelection,
  getModelProvider,
} from "./model-selection.js";
import type { SessionEvent } from "./session.js";

describe("model selection", () => {
  const providers = [
    { id: "openai", provider: "openai", model: "gpt-5.5", auth: { type: "oauth" } },
    { id: "deepseek", provider: "deepseek", model: "deepseek-v4-pro" },
  ];

  it("uses the first provider by default", () => {
    expect(getDefaultModelSelection({ modelProviders: providers })).toEqual({
      providerId: "openai",
      model: "gpt-5.5",
    });
  });

  it("restores the latest model switch event", () => {
    expect(
      getLatestModelSelection({
        modelProviders: providers,
        events: [
          event(1, "model_switch", { providerId: "openai", model: "gpt-5.5" }),
          event(2, "model_switch", { providerId: "deepseek", model: "deepseek-v4-pro" }),
        ],
      }),
    ).toEqual({ providerId: "deepseek", model: "deepseek-v4-pro" });
  });

  it("looks up providers by id", () => {
    expect(getModelProvider({ providerId: "deepseek", modelProviders: providers })).toEqual({
      id: "deepseek",
      provider: "deepseek",
      model: "deepseek-v4-pro",
    });
  });
});

function event(sequence: number, type: SessionEvent["type"], payload: unknown): SessionEvent {
  return {
    id: `${sequence}`,
    sessionId: "session",
    sequence,
    type,
    payload,
    createdAt: new Date(sequence).toISOString(),
  };
}
