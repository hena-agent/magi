import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

export function resolveWorkspacePath(workspaceRoot: string, path: unknown): string {
  if (typeof path !== "string") {
    throw new Error("Path must be a string.");
  }

  const resolvedPath = resolve(workspaceRoot, path);
  const relativePath = relative(workspaceRoot, resolvedPath);

  if (
    relativePath.startsWith("..") ||
    relativePath === "" ||
    relativePath.includes(`..${dirname("/")}`)
  ) {
    throw new Error(`Path escapes workspace root: ${path}`);
  }

  return resolvedPath;
}

export function writeFileWithDirs(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

export function toPosix(path: string): string {
  return path.split(dirname("/")).join("/");
}
