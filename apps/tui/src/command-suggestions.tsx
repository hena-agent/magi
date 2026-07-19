import { Box, Text } from "ink";
import { formatCommandSuggestion } from "./command-suggestions-format.js";
import type { SlashCommandInfo } from "./slash-commands.js";

export function CommandSuggestions(props: {
  commands: SlashCommandInfo[];
  selectedIndex: number;
  hidden: boolean;
  compact?: boolean;
  limit?: number;
}) {
  if (props.hidden || props.commands.length === 0) return null;
  const visibleCommands = props.commands.slice(0, props.limit ?? props.commands.length);
  const hiddenCount = props.commands.length - visibleCommands.length;

  return (
    <Box flexDirection="column" paddingX={2}>
      {visibleCommands.map((command, index) => {
        const selected = index === props.selectedIndex;
        return (
          <Text key={command.name} bold={selected} color={selected ? "cyan" : undefined}>
            {props.compact
              ? `${selected ? "›" : " "} /${command.name}  ${command.description}`
              : formatCommandSuggestion(command, selected)}
          </Text>
        );
      })}
      {hiddenCount > 0 ? <Text dimColor>{`  … ${hiddenCount} more commands`}</Text> : null}
    </Box>
  );
}
