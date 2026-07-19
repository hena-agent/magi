import { Box, Text } from "ink";
import { formatComposerCursorDisplay, getComposerViewport } from "./composer-format.js";

export function Composer(props: {
  prompt: string;
  cursor: number;
  disabled: boolean;
  maxLines?: number;
  width?: number;
}) {
  const viewport = getComposerViewport({
    prompt: props.prompt,
    cursor: props.cursor,
    columns: Math.max(12, (props.width ?? 80) - 6),
    maxLines: props.maxLines ?? 5,
  });

  return (
    <Box borderStyle="round" borderColor={props.disabled ? "gray" : "cyan"} paddingX={1}>
      <Text dimColor={props.disabled}>{props.disabled ? "waiting" : ">"} </Text>
      <Box flexDirection="column">
        {viewport.hiddenAbove > 0 ? (
          <Text dimColor>{`↑ ${viewport.hiddenAbove} earlier lines`}</Text>
        ) : null}
        <PromptText
          prompt={viewport.prompt}
          cursor={viewport.cursor}
          placeholder={props.disabled ? "Waiting for your response..." : "Ask for a change..."}
        />
        {viewport.hiddenBelow > 0 ? (
          <Text dimColor>{`↓ ${viewport.hiddenBelow} later lines`}</Text>
        ) : null}
      </Box>
    </Box>
  );
}

function PromptText(props: { prompt: string; cursor: number; placeholder: string }) {
  const display = formatComposerCursorDisplay(props.prompt, props.cursor, props.placeholder);

  return (
    <Text dimColor={display.isPlaceholder}>
      {display.before}
      <Text inverse>{display.cursor}</Text>
      {display.after}
    </Text>
  );
}
