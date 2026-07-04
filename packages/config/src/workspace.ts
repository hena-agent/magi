import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export function findWorkspaceRoot(startPath: string): string {
  let currentPath = startPath;

  while (true) {
    if (existsSync(join(currentPath, "pnpm-workspace.yaml"))) {
      return currentPath;
    }

    const parentPath = dirname(currentPath);

    if (parentPath === currentPath) {
      return startPath;
    }

    currentPath = parentPath;
  }
}
