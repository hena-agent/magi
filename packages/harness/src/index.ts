import { spawn, spawnSync } from "node:child_process";

export type CommandResult = {
  command: string;
  status: "passed" | "failed" | "interrupted";
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
  signal?: AbortSignal;
}): Promise<VerificationResult> {
  const startedAt = performance.now();

  try {
    const result = await runShellCommand(input.command, {
      cwd: input.cwd,
      maxBuffer: 1024 * 1024 * 10,
      signal: input.signal,
      timeoutMs: input.timeoutMs ?? 120_000,
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

    if (input.signal?.aborted) {
      return {
        command: input.command,
        status: "interrupted",
        exitCode,
        durationMs: Math.round(performance.now() - startedAt),
        stdout: execError.stdout ?? "",
        stderr: execError.stderr ?? execError.message ?? "Verification interrupted.",
      };
    }

    return {
      ...createCommandResult(input.command, exitCode, Math.round(performance.now() - startedAt)),
      stdout: execError.stdout ?? "",
      stderr: execError.stderr ?? execError.message ?? execError.signal ?? "",
    };
  }
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: Process output, timeout, and cancellation share one settlement boundary.
function runShellCommand(
  command: string,
  input: { cwd: string; maxBuffer: number; signal?: AbortSignal; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  input.signal?.throwIfAborted();
  // biome-ignore lint/complexity/noExcessiveLinesPerFunction: Keep process settlement state inside one promise executor.
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: input.cwd,
      shell: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      input.signal?.removeEventListener("abort", onAbort);
    };
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Platform-specific process-tree termination is intentionally local.
    const terminate = () => {
      if (process.platform === "win32" && child.pid !== undefined) {
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      } else {
        child.kill("SIGKILL");
      }
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      terminate();
      cleanup();
      Object.assign(error, { stdout, stderr });
      reject(error);
    };
    const onAbort = () =>
      fail(
        input.signal?.reason instanceof Error
          ? input.signal.reason
          : new DOMException("Operation aborted", "AbortError"),
      );
    const append = (target: "stdout" | "stderr", chunk: string) => {
      if (target === "stdout") stdout += chunk;
      else stderr += chunk;
      if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > input.maxBuffer)
        fail(new Error(`Command output exceeded ${input.maxBuffer} bytes`));
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => append("stdout", chunk));
    child.stderr.on("data", (chunk: string) => append("stderr", chunk));
    child.once("error", fail);
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          Object.assign(new Error(`Command failed with exit code ${code ?? 1}`), {
            code,
            signal,
            stdout,
            stderr,
          }),
        );
    });
    const timeout = setTimeout(
      () => fail(new Error(`Command timed out after ${input.timeoutMs}ms`)),
      input.timeoutMs,
    );
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) onAbort();
  });
}

export async function runVerificationCommands(input: {
  commands: string[];
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const command of input.commands) {
    if (results.length > 0 && input.signal?.aborted) break;

    results.push(
      await runVerificationCommand({
        command,
        cwd: input.cwd,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      }),
    );

    if (results.at(-1)?.status === "interrupted") break;
  }

  return results;
}
