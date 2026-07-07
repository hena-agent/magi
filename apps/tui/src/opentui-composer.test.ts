import { describe, expect, it } from "vitest";
import {
  formatComposerCursorDisplay,
  formatComposerPromptDisplay,
} from "./opentui-composer-format.js";

describe("formatComposerPromptDisplay", () => {
  it("shows prompt text without inline cursor markers", () => {
    expect(formatComposerPromptDisplay("abc")).toBe("abc");
  });

  it("shows placeholder text for empty prompts", () => {
    expect(formatComposerPromptDisplay("", "Ask anything...")).toBe("Ask anything...");
  });
});

describe("formatComposerCursorDisplay", () => {
  it("splits prompt text around the cursor", () => {
    expect(formatComposerCursorDisplay("abc", 1)).toEqual({
      after: "c",
      before: "a",
      cursor: "b",
      isPlaceholder: false,
    });
  });

  it("uses a blank cursor cell at the end of prompt text", () => {
    expect(formatComposerCursorDisplay("abc", 3)).toEqual({
      after: "",
      before: "abc",
      cursor: " ",
      isPlaceholder: false,
    });
  });

  it("places the cursor over the first placeholder character", () => {
    expect(formatComposerCursorDisplay("", 0, "Ask anything...")).toEqual({
      after: "sk anything...",
      before: "",
      cursor: "A",
      isPlaceholder: true,
    });
  });
});
