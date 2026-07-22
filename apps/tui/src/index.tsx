#!/usr/bin/env node
import { render } from "ink";
import { App } from "./app.js";
import { type AppShutdownReason, createAppLifecycle } from "./app-lifecycle.js";
import { CLI_USAGE, resolveTargetDirectory } from "./cli.js";
import { canUseFullscreenTerminal, enterAlternateScreen } from "./terminal-layout.js";

function main(): void {
  let targetDirectory: string;
  try {
    targetDirectory = resolveTargetDirectory(
      process.argv.slice(2),
      process.env.INIT_CWD ?? process.cwd(),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`magi: ${message}\n${CLI_USAGE}\n`);
    process.exitCode = 1;
    return;
  }

  const fullscreen = canUseFullscreenTerminal();
  const restoreTerminal = fullscreen ? enterAlternateScreen() : undefined;
  const lifecycle = createAppLifecycle();
  const app = render(
    <App fullscreen={fullscreen} lifecycle={lifecycle} targetDirectory={targetDirectory} />,
  );
  let signalCount = 0;

  if (restoreTerminal) process.once("exit", restoreTerminal);
  process.on("SIGINT", () => void handleSignal("sigint", 130));
  process.on("SIGTERM", () => void handleSignal("sigterm", 143));
  app.waitUntilExit().finally(() => restoreTerminal?.());

  async function handleSignal(reason: AppShutdownReason, exitCode: number): Promise<void> {
    signalCount += 1;
    if (signalCount > 1) {
      restoreTerminal?.();
      process.exit(exitCode);
    }

    let timeout: NodeJS.Timeout | undefined;
    let shutdownCompleted = false;
    try {
      shutdownCompleted = await Promise.race([
        lifecycle.shutdown(reason).then(
          () => true,
          () => false,
        ),
        new Promise<void>((resolve) => {
          timeout = setTimeout(resolve, 5_000);
        }).then(() => false),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (!shutdownCompleted) process.exit(exitCode);
    app.unmount();
    restoreTerminal?.();
    process.exitCode = exitCode;
  }
}

main();
