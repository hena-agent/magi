import type { SlashCommandInfo } from "./slash-commands.js";

export function formatCommandSuggestion(command: SlashCommandInfo, selected: boolean): string {
  const commandName = `/${command.name}`.padEnd(14, " ");

  return `${selected ? "›" : " "} ${commandName}${command.description}`;
}
