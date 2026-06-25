import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

export type MagiConfig = {
  workspaceRoot: string;
  verificationCommands: string[];
};

export function getDefaultConfig(): MagiConfig {
  return {
    workspaceRoot: findWorkspaceRoot(process.env.INIT_CWD ?? process.cwd()),
    verificationCommands: ["pnpm typecheck", "pnpm test", "pnpm lint", "pnpm knip"],
  };
}

function findWorkspaceRoot(startPath: string): string {
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
