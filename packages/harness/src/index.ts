export type CommandResult = {
  command: string;
  status: "passed" | "failed";
  exitCode: number;
  durationMs: number;
};

export function createCommandResult(
  command: string,
  exitCode: number,
  durationMs: number,
): CommandResult {
  return {
    command,
    status: exitCode === 0 ? "passed" : "failed",
    exitCode,
    durationMs,
  };
}
