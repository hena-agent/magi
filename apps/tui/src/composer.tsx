import { Box, Text } from "ink";

export function Composer(props: { prompt: string; cursor: number; disabled: boolean }) {
  return (
    <Box borderStyle="round" borderColor={props.disabled ? "gray" : "green"} paddingX={1}>
      <Text color={props.disabled ? "gray" : "green"}>{props.disabled ? "waiting" : ">"} </Text>
      <PromptText prompt={props.prompt} cursor={props.cursor} />
    </Box>
  );
}

function PromptText(props: { prompt: string; cursor: number }) {
  const before = props.prompt.slice(0, props.cursor);
  const cursorChar = props.prompt[props.cursor] ?? " ";
  const after = props.prompt.slice(props.cursor + (props.prompt[props.cursor] ? 1 : 0));

  return (
    <Text>
      {before}
      <Text inverse>{cursorChar}</Text>
      {after}
    </Text>
  );
}
