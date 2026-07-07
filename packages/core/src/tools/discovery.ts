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
  const regex = new RegExp(`^${globPatternToRegexSource(pattern)}$`);

  return (path) => regex.test(path);
}

function globPatternToRegexSource(pattern: string): string {
  let source = "";
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 3;
      } else {
        source += ".*";
        index += 2;
      }
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      index += 1;
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      index += 1;
      continue;
    }

    if (char === "{") {
      const closeIndex = pattern.indexOf("}", index + 1);
      if (closeIndex !== -1) {
        const alternatives = pattern
          .slice(index + 1, closeIndex)
          .split(",")
          .map((alternative) => globPatternToRegexSource(alternative));
        source += `(?:${alternatives.join("|")})`;
        index = closeIndex + 1;
        continue;
      }
    }

    source += escapeRegexChar(char ?? "");
    index += 1;
  }

  return source;
}

function escapeRegexChar(char: string): string {
  return /[\\^$+?.()|[\]{}]/.test(char) ? `\\${char}` : char;
}
