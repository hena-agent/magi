import { statSync } from "node:fs";
import { resolve } from "node:path";

export const CLI_USAGE = "Usage: magi [directory]";

export function resolveTargetDirectory(args: string[], launchDirectory: string): string {
  if (args.length > 1) {
    throw new Error("Expected at most one target directory");
  }

  const targetDirectory = resolve(launchDirectory, args[0] ?? ".");
  let stats: ReturnType<typeof statSync>;
  try {
    stats = statSync(targetDirectory);
  } catch {
    throw new Error(`Cannot access target directory: ${targetDirectory}`);
  }

  if (!stats.isDirectory()) {
    throw new Error(`Target path is not a directory: ${targetDirectory}`);
  }

  return targetDirectory;
}
