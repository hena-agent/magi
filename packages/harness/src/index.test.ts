import { describe, expect, it } from "vitest";
import { createCommandResult, runVerificationCommand, runVerificationCommands } from "./index.js";

describe("createCommandResult", () => {
  it("marks zero exit codes as passed", () => {
    expect(createCommandResult("pnpm test", 0, 12).status).toBe("passed");
  });

  it("marks non-zero exit codes as failed", () => {
    expect(createCommandResult("pnpm test", 1, 12).status).toBe("failed");
  });
});

describe("runVerificationCommand", () => {
  it("captures command success", async () => {
    await expect(
      runVerificationCommand({ command: "node -e \"console.log('ok')\"", cwd: process.cwd() }),
    ).resolves.toMatchObject({ status: "passed", exitCode: 0, stdout: "ok\n" });
  });

  it("captures command failure", async () => {
    await expect(
      runVerificationCommand({ command: 'node -e "process.exit(2)"', cwd: process.cwd() }),
    ).resolves.toMatchObject({ status: "failed", exitCode: 2 });
  });

  it("reports caller cancellation as interrupted", async () => {
    const controller = new AbortController();
    const operation = runVerificationCommand({
      command: 'node -e "setTimeout(() => {}, 10000)"',
      cwd: process.cwd(),
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).resolves.toMatchObject({ status: "interrupted" });
  });
});

describe("runVerificationCommands", () => {
  it("does not start later commands after interruption", async () => {
    const controller = new AbortController();
    const operation = runVerificationCommands({
      commands: [
        'node -e "setTimeout(() => {}, 10000)"',
        "node -e \"process.stdout.write('should not run')\"",
      ],
      cwd: process.cwd(),
      signal: controller.signal,
    });
    controller.abort();

    await expect(operation).resolves.toMatchObject([{ status: "interrupted" }]);
  });
});
