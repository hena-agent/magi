import type { SessionEvent } from "./session.js";

export type VerificationFailure = {
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  createdAt: string;
};

export type VerificationFailureContext = {
  failures: VerificationFailure[];
  text: string;
};

export function getLatestVerificationFailures(input: {
  events: SessionEvent[];
  limit?: number;
  maxOutputChars?: number;
}): VerificationFailureContext {
  const limit = input.limit ?? 3;
  const maxOutputChars = input.maxOutputChars ?? 4_000;
  const failures = input.events
    .filter((event) => event.type === "verification_result")
    .flatMap((event) => toVerificationFailure(event, maxOutputChars))
    .reverse()
    .slice(0, limit);

  return {
    failures,
    text: formatFailures(failures),
  };
}

function toVerificationFailure(event: SessionEvent, maxOutputChars: number): VerificationFailure[] {
  const payload = event.payload as Record<string, unknown>;

  if (
    payload.status !== "failed" ||
    typeof payload.command !== "string" ||
    typeof payload.exitCode !== "number" ||
    typeof payload.durationMs !== "number"
  ) {
    return [];
  }

  return [
    {
      command: payload.command,
      exitCode: payload.exitCode,
      durationMs: payload.durationMs,
      stdout: truncateTail(
        typeof payload.stdout === "string" ? payload.stdout : "",
        maxOutputChars,
      ),
      stderr: truncateTail(
        typeof payload.stderr === "string" ? payload.stderr : "",
        maxOutputChars,
      ),
      createdAt: event.createdAt,
    },
  ];
}

function formatFailures(failures: VerificationFailure[]): string {
  if (failures.length === 0) {
    return "No verification failures found.";
  }

  return [
    "Latest verification failures:",
    "",
    ...failures.map((failure, index) =>
      [
        `${index + 1}. ${failure.command}`,
        `Exit code: ${failure.exitCode}`,
        `Duration: ${failure.durationMs}ms`,
        "",
        "stdout:",
        failure.stdout || "(empty)",
        "",
        "stderr:",
        failure.stderr || "(empty)",
      ].join("\n"),
    ),
  ].join("\n\n");
}

export function truncateTail(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  return `[truncated ${value.length - maxChars} chars]\n${value.slice(-maxChars)}`;
}
