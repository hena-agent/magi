import { describe, expect, it } from "vitest";
import { getFooterShortcutText } from "./status-bar.js";

describe("getFooterShortcutText", () => {
  it("shows default shortcuts when no overlay is active", () => {
    expect(getFooterShortcutText(undefined)).toBe(
      "/model · /agent · /sessions · /help · ctrl+c exit",
    );
  });

  it("shows overlay-specific shortcuts", () => {
    expect(getFooterShortcutText("permission")).toBe("Permission: [y] allow [n] deny [esc] cancel");
    expect(getFooterShortcutText("selector")).toBe("Selector: ↑/↓ select enter confirm esc cancel");
    expect(getFooterShortcutText("question")).toBe(
      "Question: ↑/↓ select space mark enter submit esc cancel",
    );
    expect(getFooterShortcutText("suggestions")).toBe("↑/↓ select · tab/enter complete");
  });
});
