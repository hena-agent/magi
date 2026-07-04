import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";

export function listFiles(root: string): string[] {
  const files: string[] = [];
  const ignoredDirectories = new Set([".git", "node_modules", ".turbo", "dist", "coverage"]);

  walk(root);

  return files;

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);

      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) {
          walk(entryPath);
        }

        continue;
      }

      if (entry.isFile() && existsSync(entryPath) && !basename(entryPath).endsWith(".db")) {
        files.push(entryPath);
      }
    }
  }
}

export function createGlobMatcher(pattern: string): (path: string) => boolean {
  const escaped = pattern
    .replaceAll(".", "\\.")
    .replaceAll("+", "\\+")
    .replaceAll("?", "\\?")
    .replaceAll("^", "\\^")
    .replaceAll("$", "\\$")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("{", "\\{")
    .replaceAll("}", "\\}")
    .replaceAll("|", "\\|")
    .replaceAll("**", "::DOUBLE_STAR::")
    .replaceAll("*", "[^/]*")
    .replaceAll("::DOUBLE_STAR::", ".*");
  const regex = new RegExp(`^${escaped}$`);

  return (path) => regex.test(path);
}
