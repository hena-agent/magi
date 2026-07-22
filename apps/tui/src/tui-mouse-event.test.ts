import { describe, expect, it } from "vitest";
import { parseTuiMouseEvent } from "./tui-mouse-event.js";

describe("parseTuiMouseEvent", () => {
  it("parses zero-based SGR mouse coordinates", () => {
    expect(parseTuiMouseEvent("\u001b[<0;12;7M")).toEqual({
      type: "press",
      button: "left",
      x: 11,
      y: 6,
      ctrl: false,
      meta: false,
      shift: false,
    });
    expect(parseTuiMouseEvent("\u001b[<0;12;7m")).toMatchObject({
      type: "release",
      button: "left",
    });
    expect(parseTuiMouseEvent("[<0;12;7M")).toMatchObject({ type: "press", button: "left" });
  });

  it("parses wheel direction and modifiers", () => {
    expect(parseTuiMouseEvent("\u001b[<84;2;3M")).toEqual({
      type: "wheel",
      button: "none",
      direction: "up",
      x: 1,
      y: 2,
      ctrl: true,
      meta: false,
      shift: true,
    });
    expect(parseTuiMouseEvent("\u001b[<65;2;3M")).toMatchObject({
      type: "wheel",
      direction: "down",
    });
  });

  it("rejects unrelated and invalid input", () => {
    expect(parseTuiMouseEvent("hello")).toBeUndefined();
    expect(parseTuiMouseEvent("\u001b[<0;0;1M")).toBeUndefined();
  });
});
