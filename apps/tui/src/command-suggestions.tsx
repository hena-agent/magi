import { Box, Text } from "ink";
import type { SlashCommandInfo } from "./app-controller.js";

export function CommandSuggestions(props: {
  commands: SlashCommandInfo[];
  selectedIndex: number;
  hidden: boolean;
}) {
  if (props.hidden || props.commands.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="gray" paddingX={1}>
      <Text bold>Commands</Text>
      {props.commands.map((command, index) => {
        const selected = index === props.selectedIndex;
        return (
          <Text key={command.name} bold={selected}>
            {`${selected ? "›" : " "} ${command.usage}  [${command.category ?? "Tools"}] ${command.description}`}
          </Text>
        );
      })}
      <Text dimColor>↑/↓ select tab complete enter run</Text>
    </Box>
  );
}
