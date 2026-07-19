import { existsSync, lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

function isOutside(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

export function resolveWorkspacePath(workspaceRoot: string, path: unknown): string {
  if (typeof path !== "string") {
    throw new Error("Path must be a string.");
  }

  const resolvedPath = resolve(workspaceRoot, path);
  const relativePath = relative(workspaceRoot, resolvedPath);

  if (relativePath === "" || isOutside(workspaceRoot, resolvedPath)) {
    throw new Error(`Path escapes workspace root: ${path}`);
  }

  const realWorkspaceRoot = realpathSync(workspaceRoot);
  assertSafeSymlinkComponents(workspaceRoot, relativePath, realWorkspaceRoot, path);

  let existingPath = resolvedPath;
  while (!existsSync(existingPath)) {
    existingPath = dirname(existingPath);
  }

  if (isOutside(realWorkspaceRoot, realpathSync(existingPath))) {
    throw new Error(`Path escapes workspace root: ${path}`);
  }

  return resolvedPath;
}

function assertSafeSymlinkComponents(
  workspaceRoot: string,
  relativePath: string,
  realWorkspaceRoot: string,
  inputPath: string,
): void {
  let candidate = workspaceRoot;
  for (const segment of relativePath.split(sep)) {
    candidate = resolve(candidate, segment);
    const stats = lstatSync(candidate, { throwIfNoEntry: false });
    if (!stats) return;
    if (!stats.isSymbolicLink()) continue;

    let realTarget: string;
    try {
      realTarget = realpathSync(candidate);
    } catch {
      throw new Error(`Path contains a dangling symlink: ${inputPath}`);
    }

    if (isOutside(realWorkspaceRoot, realTarget)) {
      throw new Error(`Path escapes workspace root: ${inputPath}`);
    }
  }
}

export function writeFileWithDirs(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content);
}

export function toPosix(path: string): string {
  return path.split(dirname("/")).join("/");
}
