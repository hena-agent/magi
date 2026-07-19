import { describe, expect, it } from "vitest";
import { formatCommandSuggestion } from "./command-suggestions-format.js";

describe("formatCommandSuggestion", () => {
  it("formats selected command suggestions", () => {
    expect(
      formatCommandSuggestion(
        {
          name: "model",
          usage: "/model [provider-id|status|reset]",
          description: "List or switch AI models",
          category: "Model/Auth",
        },
        true,
      ),
    ).toBe("› /model        List or switch AI models");
  });

  it("formats unselected command suggestions", () => {
    expect(
      formatCommandSuggestion(
        { name: "help", usage: "/help", description: "Show commands" },
        false,
      ),
    ).toBe("  /help         Show commands");
  });
});
