import { describe, expect, it } from "vitest";
import { isExitKey, normalizeInkInputEvent, normalizeOpenTuiKeyEvent } from "./tui-key-event.js";

describe("normalizeOpenTuiKeyEvent", () => {
  it("normalizes named navigation keys", () => {
    expect(normalizeOpenTuiKeyEvent({ name: "upArrow" })).toMatchObject({
      name: "up",
      input: "",
    });
    expect(normalizeOpenTuiKeyEvent({ name: "PageDown" })).toMatchObject({
      name: "pagedown",
      input: "",
    });
    expect(normalizeOpenTuiKeyEvent({ name: "enter" })).toMatchObject({
      name: "return",
      input: "",
    });
    expect(normalizeOpenTuiKeyEvent({ name: "esc" })).toMatchObject({
      name: "escape",
      input: "",
    });
  });

  it("keeps printable input separate from normalized key names", () => {
    expect(normalizeOpenTuiKeyEvent({ name: "a", raw: "a" })).toEqual({
      name: "a",
      input: "a",
      ctrl: false,
      meta: false,
      shift: false,
      super: false,
    });
    expect(normalizeOpenTuiKeyEvent({ name: "space", raw: " " }).input).toBe(" ");
    expect(normalizeOpenTuiKeyEvent({ name: "c", raw: "c", ctrl: true }).input).toBe("");
  });

  it("preserves OpenTUI super/cmd modifiers", () => {
    expect(normalizeOpenTuiKeyEvent({ name: "v", super: true })).toMatchObject({
      input: "",
      name: "v",
      super: true,
    });
  });
});

describe("isExitKey", () => {
  it("matches ctrl+c and plain q", () => {
    expect(isExitKey(normalizeOpenTuiKeyEvent({ name: "c", ctrl: true }))).toBe(true);
    expect(isExitKey(normalizeOpenTuiKeyEvent({ name: "q", raw: "q" }))).toBe(true);
  });

  it("does not match modified q or plain c", () => {
    expect(isExitKey(normalizeOpenTuiKeyEvent({ name: "q", raw: "q", meta: true }))).toBe(false);
    expect(isExitKey(normalizeOpenTuiKeyEvent({ name: "c", raw: "c" }))).toBe(false);
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
});
