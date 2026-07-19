export type TuiKeyEvent = {
  name: string;
  input: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  super: boolean;
};

export type InkKeyLike = {
  backspace?: boolean;
  ctrl?: boolean;
  delete?: boolean;
  downArrow?: boolean;
  end?: boolean;
  escape?: boolean;
  home?: boolean;
  leftArrow?: boolean;
  meta?: boolean;
  pageDown?: boolean;
  pageUp?: boolean;
  return?: boolean;
  rightArrow?: boolean;
  shift?: boolean;
  tab?: boolean;
  upArrow?: boolean;
};

const nonPrintableKeyNames = new Set([
  "backspace",
  "delete",
  "down",
  "end",
  "escape",
  "home",
  "left",
  "pagedown",
  "pageup",
  "return",
  "right",
  "tab",
  "up",
]);

export function normalizeInkInputEvent(input: string, key: InkKeyLike): TuiKeyEvent {
  const name = readInkKeyName(input, key);
  const raw = stripInkBracketedPasteMarkers(input);
  const ctrl = key.ctrl === true;
  const meta = key.meta === true;
  const shift = key.shift === true;

  return {
    name,
    input: readPrintableInput({ name, raw, ctrl, meta, super: false }),
    ctrl,
    meta,
    shift,
    super: false,
  };
}

export function stripInkBracketedPasteMarkers(input: string): string {
  const escapeCharacter = String.fromCharCode(27);
  const startMarkers = [`${escapeCharacter}[200~`, "[200~"];
  const endMarkers = [`${escapeCharacter}[201~`, "[201~"];
  let value = input;

  for (const marker of startMarkers) {
    if (value.startsWith(marker)) {
      value = value.slice(marker.length);
      break;
    }
  }
  for (const marker of endMarkers) {
    if (value.endsWith(marker)) {
      value = value.slice(0, -marker.length);
      break;
    }
  }

  return value;
}

export function isExitKey(event: TuiKeyEvent): boolean {
  return (event.ctrl && event.name === "c") || (!event.ctrl && !event.meta && event.input === "q");
}

function normalizeKeyName(name: string): string {
  const normalized = name.toLowerCase().replaceAll(/[-_\s]/g, "");

  switch (normalized) {
    case "esc":
      return "escape";
    case "enter":
      return "return";
    case "uparrow":
      return "up";
    case "downarrow":
      return "down";
    case "leftarrow":
      return "left";
    case "rightarrow":
      return "right";
    case "pageup":
      return "pageup";
    case "pagedown":
      return "pagedown";
    default:
      return normalized;
  }
}

function readInkKeyName(input: string, key: InkKeyLike): string {
  if (key.escape) return "escape";
  if (key.return) return "return";
  if (key.tab) return "tab";
  if (key.backspace) return "backspace";
  if (key.delete) return "delete";
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";
  if (key.home) return "home";
  if (key.end) return "end";
  if (input === " ") return "space";
  return normalizeKeyName(input);
}

function readPrintableInput(input: {
  name: string;
  raw: string;
  ctrl: boolean;
  meta: boolean;
  super: boolean;
}): string {
  if (input.ctrl || input.meta || input.super) return "";
  if (nonPrintableKeyNames.has(input.name)) return "";
  if (input.raw.length > 0) return input.raw;
  if (input.name.length === 1) return input.name;
  if (input.name === "space") return " ";
  return "";
}
