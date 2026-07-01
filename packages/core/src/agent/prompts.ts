import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const promptDirectory = fileURLToPath(new URL("./prompt", import.meta.url));

export function readAgentPrompt(name: string): string {
  return readFileSync(join(promptDirectory, `${name}.txt`), "utf8").trim();
}

export const MAGI_BUILD_PROMPT = readAgentPrompt("build");
export const MAGI_PLAN_REMINDER = readAgentPrompt("plan");
export const MAGI_BUILD_SWITCH_REMINDER = readAgentPrompt("build-switch");
export const MAGI_EXPLORE_PROMPT = readAgentPrompt("explore");
export const MAGI_SUMMARY_PROMPT = readAgentPrompt("summary");
export const MAGI_TITLE_PROMPT = readAgentPrompt("title");
export const MAGI_COMPACTION_PROMPT = readAgentPrompt("compaction");
