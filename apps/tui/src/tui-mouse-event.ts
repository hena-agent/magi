export type TuiMouseEvent = {
  type: "press" | "release" | "move" | "wheel";
  button: "left" | "middle" | "right" | "none";
  direction?: "up" | "down";
  x: number;
  y: number;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};

const sgrMousePattern = /^\[<(\d+);(\d+);(\d+)([Mm])$/;
const escapeCharacter = String.fromCharCode(27);

export function parseTuiMouseEvent(input: string): TuiMouseEvent | undefined {
  const normalizedInput = input.startsWith(escapeCharacter) ? input.slice(1) : input;
  const match = sgrMousePattern.exec(normalizedInput);
  if (!match) return undefined;

  const code = Number(match[1]);
  const x = Number(match[2]) - 1;
  const y = Number(match[3]) - 1;
  const suffix = match[4];
  if (!Number.isSafeInteger(code) || x < 0 || y < 0) return undefined;

  const modifiers = {
    shift: (code & 4) !== 0,
    meta: (code & 8) !== 0,
    ctrl: (code & 16) !== 0,
  };

  if ((code & 64) !== 0) {
    return {
      type: "wheel",
      button: "none",
      direction: (code & 1) === 0 ? "up" : "down",
      x,
      y,
      ...modifiers,
    };
  }

  const button = readMouseButton(code & 3);
  return {
    type: suffix === "m" ? "release" : (code & 32) !== 0 ? "move" : "press",
    button,
    x,
    y,
    ...modifiers,
  };
}

function readMouseButton(code: number): TuiMouseEvent["button"] {
  if (code === 0) return "left";
  if (code === 1) return "middle";
  if (code === 2) return "right";
  return "none";
}
