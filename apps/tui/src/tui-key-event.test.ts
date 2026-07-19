import { describe, expect, it } from "vitest";
import {
  isExitKey,
  normalizeInkInputEvent,
  stripInkBracketedPasteMarkers,
} from "./tui-key-event.js";

describe("isExitKey", () => {
  it("matches ctrl+c and plain q", () => {
    expect(isExitKey(normalizeInkInputEvent("c", { ctrl: true }))).toBe(true);
    expect(isExitKey(normalizeInkInputEvent("q", {}))).toBe(true);
  });

  it("does not match modified q or plain c", () => {
    expect(isExitKey(normalizeInkInputEvent("q", { meta: true }))).toBe(false);
    expect(isExitKey(normalizeInkInputEvent("c", {}))).toBe(false);
  });
});

describe("normalizeInkInputEvent", () => {
  it("maps Ink named key booleans to shared key names", () => {
    expect(normalizeInkInputEvent("", { upArrow: true })).toMatchObject({
      name: "up",
      input: "",
    });
    expect(normalizeInkInputEvent("", { pageDown: true })).toMatchObject({
      name: "pagedown",
      input: "",
    });
    expect(normalizeInkInputEvent("", { return: true })).toMatchObject({
      name: "return",
      input: "",
    });
    expect(normalizeInkInputEvent("", { escape: true })).toMatchObject({
      name: "escape",
      input: "",
    });
  });

  it("keeps Ink printable input and modifiers separate", () => {
    expect(normalizeInkInputEvent("a", {})).toEqual({
      name: "a",
      input: "a",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
    });
    expect(normalizeInkInputEvent(" ", {})).toMatchObject({ name: "space", input: " " });
    expect(normalizeInkInputEvent("c", { ctrl: true })).toMatchObject({
      name: "c",
      input: "",
      ctrl: true,
    });
  });

  it("preserves multi-character and multiline Ink paste input", () => {
    expect(normalizeInkInputEvent("/model", {}).input).toBe("/model");
    expect(normalizeInkInputEvent("first\nsecond", {}).input).toBe("first\nsecond");
  });

  it("removes Ink bracketed paste markers without dropping newlines", () => {
    const escapeCharacter = String.fromCharCode(27);
    const paste = `[200~first line\nsecond line${escapeCharacter}[201~`;

    expect(stripInkBracketedPasteMarkers(paste)).toBe("first line\nsecond line");
    expect(normalizeInkInputEvent(paste, {}).input).toBe("first line\nsecond line");
  });
});
