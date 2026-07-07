/** @jsxImportSource @opentui/react */
import type { SlashCommandInfo } from "./slash-commands.js";

export type OpenTuiCommandSuggestionsProps = {
  commands: SlashCommandInfo[];
  selectedIndex: number;
  hidden: boolean;
  textColor: string;
  width?: number;
};

export function OpenTuiCommandSuggestions(props: OpenTuiCommandSuggestionsProps) {
  if (props.hidden || props.commands.length === 0) return null;

  return (
    <box width={props.width} style={{ flexDirection: "column", paddingLeft: 1 }}>
      {props.commands.map((command, index) => (
        <text
          bg={index === props.selectedIndex ? "#3b82f6" : undefined}
          fg={index === props.selectedIndex ? "#ffffff" : props.textColor}
          key={command.name}
        >
          {formatOpenTuiCommandSuggestion(command, index === props.selectedIndex)}
        </text>
      ))}
    </box>
  );
}

export function formatOpenTuiCommandSuggestion(
  command: SlashCommandInfo,
  selected: boolean,
): string {
  const commandName = `/${command.name}`.padEnd(14, " ");

  return `${selected ? " " : " "}${commandName}${command.description}`;
}
