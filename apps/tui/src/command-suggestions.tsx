import { Box, Text } from "ink";
import type { SlashCommandInfo } from "./app-controller.js";

export function CommandSuggestions(props: {
  commands: SlashCommandInfo[];
  selectedIndex: number;
  hidden: boolean;
}) {
  if (props.hidden || props.commands.length === 0) return null;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" paddingX={1}>
      <Text color="blue" bold>
        Commands
      </Text>
      {props.commands.map((command, index) => {
        const selected = index === props.selectedIndex;
        return (
          <Text
            key={command.name}
            color={selected ? "black" : undefined}
            backgroundColor={selected ? "cyan" : undefined}
          >
            {`${selected ? "›" : " "} ${command.usage}  [${command.category ?? "Tools"}] ${command.description}`}
          </Text>
        );
      })}
      <Text dimColor>↑/↓ select tab complete enter run</Text>
    </Box>
  );
}
