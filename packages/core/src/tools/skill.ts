import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { getStringField, readObject } from "./input.js";

type SkillInfo = {
  name: string;
  location: string;
};

export function skillTool(input: unknown, workspaceRoot: string): string {
  const inputObject = readObject(input, ["name"]);
  const name = getStringField(inputObject, "name");
  const skill = findSkill(name, workspaceRoot);

  if (!skill) {
    throw new Error(`Skill not found: ${name}`);
  }

  const content = readFileSync(skill.location, "utf8").trim();
  const dir = dirname(skill.location);
  const relatedFiles = listRelatedFiles(dir);

  return [
    `<skill_content name="${escapeAttribute(skill.name)}">`,
    `# Skill: ${skill.name}`,
    "",
    content,
    relatedFiles.length === 0 ? undefined : "",
    relatedFiles.length === 0 ? undefined : "## Related Files",
    ...relatedFiles.map((file) => `- ${file}`),
    "</skill_content>",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}

function findSkill(name: string, workspaceRoot: string): SkillInfo | undefined {
  if (name.includes("/") || name.includes("\\") || name === "." || name === "..") {
    throw new Error("Skill name must be a simple directory name.");
  }

  for (const root of skillRoots(workspaceRoot)) {
    const location = join(root, name, "SKILL.md");

    if (existsSync(location)) {
      return { name, location };
    }
  }

  return undefined;
}

function skillRoots(workspaceRoot: string): string[] {
  return [
    join(workspaceRoot, ".magi", "skills"),
    join(workspaceRoot, ".opencode", "skills"),
    join(homedir(), ".opencode", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
}

function listRelatedFiles(skillDirectory: string): string[] {
  if (!existsSync(skillDirectory)) {
    return [];
  }

  return readdirSync(skillDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== "SKILL.md")
    .map((entry) => basename(resolve(skillDirectory, entry.name)))
    .sort()
    .slice(0, 10);
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
}
