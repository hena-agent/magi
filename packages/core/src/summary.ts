import { execSync } from "node:child_process";
import type { SessionEvent } from "./session.js";

export type ChangeSummary = {
  changedFiles: string[];
  verificationResults: { command: string; status: "passed" | "failed" }[];
  residualRisk: "low" | "medium" | "high";
  text: string;
};

export function summarizeWorkspace(input: {
  workspaceRoot: string;
  events: SessionEvent[];
}): ChangeSummary {
  const changedFiles = readChangedFiles(input.workspaceRoot);
  const verificationResults: { command: string; status: "passed" | "failed" }[] =
    input.events.flatMap((event) => {
      if (event.type !== "verification_result") {
        return [];
      }

      const payload = event.payload as { command?: unknown; status?: unknown };

      if (typeof payload.command !== "string") {
        return [];
      }

      return [
        {
          command: payload.command,
          status: payload.status === "passed" ? ("passed" as const) : ("failed" as const),
        },
      ];
    });
  const residualRisk = getResidualRisk(changedFiles, verificationResults);
  const text = [
    "Changed files:",
    ...(changedFiles.length === 0 ? ["- none"] : changedFiles.map((file) => `- ${file}`)),
    "",
    "Verification:",
    ...(verificationResults.length === 0
      ? ["- not run"]
      : verificationResults.map((result) => `- ${result.command}: ${result.status}`)),
    "",
    `Residual risk: ${residualRisk}`,
  ].join("\n");

  return {
    changedFiles,
    verificationResults,
    residualRisk,
    text,
  };
}

function readChangedFiles(workspaceRoot: string): string[] {
  const output = execSync("git status --short", {
    cwd: workspaceRoot,
    encoding: "utf8",
  }).trim();

  if (output.length === 0) {
    return [];
  }

  return output.split("\n").map((line) => line.slice(3).trim());
}

function getResidualRisk(
  changedFiles: string[],
  verificationResults: { status: "passed" | "failed" }[],
): "low" | "medium" | "high" {
  if (verificationResults.some((result) => result.status === "failed")) {
    return "high";
  }

  if (changedFiles.length > 0 && verificationResults.length === 0) {
    return "medium";
  }

  return "low";
}
