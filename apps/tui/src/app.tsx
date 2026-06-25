import { getDefaultConfig } from "@magi/config";
import { createTask } from "@magi/core";
import { Box, Text, useApp, useInput } from "ink";

export function App() {
  const { exit } = useApp();
  const config = getDefaultConfig();
  const task = createTask("Bootstrap MAGI TUI");
  const canReadInput = Boolean(process.stdin.isTTY && process.stdin.setRawMode);

  useInput(
    (input, key) => {
      if (input === "q" || key.escape) {
        exit();
      }
    },
    {
      isActive: canReadInput,
    },
  );

  return (
    <Box flexDirection="column">
      <Text color="cyan" bold>
        MAGI
      </Text>
      <Text>Mode: {task.mode}</Text>
      <Text>Risk: {task.riskLevel}</Text>
      <Text>Workspace: {config.workspaceRoot}</Text>
      <Text dimColor>
        {canReadInput
          ? "Watching for changes. Press q or Esc to quit."
          : "Watching for changes. Stop the dev process to quit."}
      </Text>
    </Box>
  );
}
