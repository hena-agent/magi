/** @jsxImportSource @opentui/react */
import { formatComposerCursorDisplay } from "./opentui-composer-format.js";

export type OpenTuiComposerProps = {
  prompt: string;
  cursor: number;
  disabled: boolean;
  placeholder?: string;
  textColor: string;
  width?: number;
};

export function OpenTuiComposer(props: OpenTuiComposerProps) {
  const marker = props.disabled ? "waiting" : ">";
  const display = formatComposerCursorDisplay(props.prompt, props.cursor, props.placeholder);
  const cursorForeground = pickCursorForeground(props.textColor);

  return (
    <box
      borderColor="#22d3ee"
      width={props.width}
      style={{ border: true, borderStyle: "rounded", paddingLeft: 1, paddingRight: 1 }}
    >
      <text fg={props.textColor}>
        {marker} {display.before}
        <span bg={props.textColor} fg={cursorForeground}>
          {display.cursor}
        </span>
        {display.after}
      </text>
    </box>
  );
}

function pickCursorForeground(background: string): string {
  const match = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(background);
  if (!match) return "#ffffff";

  const [, redHex, greenHex, blueHex] = match;
  if (!redHex || !greenHex || !blueHex) return "#ffffff";

  const red = Number.parseInt(redHex, 16);
  const green = Number.parseInt(greenHex, 16);
  const blue = Number.parseInt(blueHex, 16);
  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;

  return luminance > 0.55 ? "#111827" : "#ffffff";
}
