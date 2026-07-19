import { describe, expect, it } from "vitest";
import { createToolCallForExecutableAction } from "./agent-action-tool-call.js";

describe("createToolCallForExecutableAction verification", () => {
  it("maps model verification to an auditable bash call", () => {
    expect(
      createToolCallForExecutableAction({
        type: "verify",
        command: "pnpm test",
        toolCallId: "verification-1",
      }),
    ).toEqual({
      id: "verification-1",
      name: "bash",
      input: { command: "pnpm test" },
    });
  });

  it("uses configured verification commands when the model omits one", () => {
    expect(
      createToolCallForExecutableAction(
        { type: "verify", toolCallId: "verification-2" },
        { verificationCommands: ["pnpm typecheck", "pnpm test"] },
      ),
    ).toMatchObject({
      name: "bash",
      input: { command: "pnpm typecheck && pnpm test" },
    });
  });

  it("does not create an empty shell call without configured commands", () => {
    expect(
      createToolCallForExecutableAction({ type: "verify", toolCallId: "verification-3" }),
    ).toBeUndefined();
  });
});
