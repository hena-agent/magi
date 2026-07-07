import { describe, expect, it } from "vitest";
import { formatOpenTuiCommandSuggestion } from "./opentui-command-suggestions.js";

describe("formatOpenTuiCommandSuggestion", () => {
  it("formats selected command suggestions", () => {
    expect(
      formatOpenTuiCommandSuggestion(
        {
          name: "model",
          usage: "/model [provider-id|status|reset]",
          description: "List or switch AI models",
          category: "Model/Auth",
        },
        true,
      ),
    ).toBe(" /model        List or switch AI models");
  });

  it("formats unselected command suggestions", () => {
    expect(
      formatOpenTuiCommandSuggestion(
        { name: "help", usage: "/help", description: "Show commands" },
        false,
      ),
    ).toBe(" /help         Show commands");
  });
});
