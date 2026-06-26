import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type CommandResult = {
  command: string;
  status: "passed" | "failed";
  exitCode: number;
  durationMs: number;
};

export type VerificationResult = CommandResult & {
  stdout: string;
  stderr: string;
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

export async function runVerificationCommand(input: {
  command: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<VerificationResult> {
  const startedAt = performance.now();

  try {
    const result = await execAsync(input.command, {
      cwd: input.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 10,
      timeout: input.timeoutMs ?? 120_000,
    });

    return {
      ...createCommandResult(input.command, 0, Math.round(performance.now() - startedAt)),
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const execError = error as {
      code?: number;
      stdout?: string;
      stderr?: string;
      signal?: string;
      message?: string;
    };
    const exitCode = typeof execError.code === "number" ? execError.code : 1;

    return {
      ...createCommandResult(input.command, exitCode, Math.round(performance.now() - startedAt)),
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message ?? execError.signal ?? "",
    };
  }
}

export async function runVerificationCommands(input: {
  commands: string[];
  cwd: string;
  timeoutMs?: number;
}): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const command of input.commands) {
    results.push(
      await runVerificationCommand({
        command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
      }),
    );
  }

  return results;
}
