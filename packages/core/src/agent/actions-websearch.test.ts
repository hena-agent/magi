import { expect, it } from "vitest";
import { agentActionToToolName, validateAgentAction } from "./actions.js";

it("validates websearch actions", () => {
  expect(
    validateAgentAction({
      type: "websearch",
      query: "magi",
      providerId: "exa",
      limit: 3,
      searchType: "fast",
    }),
  ).toEqual({
    type: "websearch",
    query: "magi",
    providerId: "exa",
    limit: 3,
    searchType: "fast",
  });
  expect(() =>
    validateAgentAction({ type: "websearch", query: "magi", providerId: "unknown" }),
  ).toThrow(/providerId/);
});

it("maps websearch actions to tool names", () => {
  expect(agentActionToToolName({ type: "websearch", query: "magi" })).toBe("websearch");
});
