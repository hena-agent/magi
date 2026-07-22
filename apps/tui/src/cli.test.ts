import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveTargetDirectory } from "./cli.js";

describe("target directory resolution", () => {
  it("uses the launch directory when no target is provided", () => {
    const launchDirectory = mkdtempSync(join(tmpdir(), "magi-cli-"));

    expect(resolveTargetDirectory([], launchDirectory)).toBe(resolve(launchDirectory));
  });

  it("resolves a relative target from the launch directory", () => {
    const launchDirectory = mkdtempSync(join(tmpdir(), "magi-cli-"));
    const targetDirectory = join(launchDirectory, "project");
    mkdirSync(targetDirectory);

    expect(resolveTargetDirectory(["project"], launchDirectory)).toBe(targetDirectory);
  });

  it("rejects inaccessible paths, files, and extra arguments", () => {
    const launchDirectory = mkdtempSync(join(tmpdir(), "magi-cli-"));
    const filePath = join(launchDirectory, "file.txt");
    writeFileSync(filePath, "not a directory\n");

    expect(() => resolveTargetDirectory(["missing"], launchDirectory)).toThrow(
      "Cannot access target directory",
    );
    expect(() => resolveTargetDirectory([filePath], launchDirectory)).toThrow(
      "Target path is not a directory",
    );
    expect(() => resolveTargetDirectory(["one", "two"], launchDirectory)).toThrow(
      "Expected at most one target directory",
    );
  });
});
