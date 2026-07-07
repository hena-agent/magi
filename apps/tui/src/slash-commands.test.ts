import { describe, expect, it } from "vitest";
import {
  formatSlashCommandCompletion,
  formatSlashCommandHelp,
  getSlashCommandSuggestions,
  visibleSlashCommands,
} from "./slash-commands.js";

describe("getSlashCommandSuggestions", () => {
  it("returns no suggestions outside slash input", () => {
    expect(getSlashCommandSuggestions("hello")).toEqual([]);
  });

  it("returns initial visible commands for bare slash", () => {
    expect(getSlashCommandSuggestions("/").map((command) => command.name)).toEqual([
      "model",
      "mode",
      "auth",
      "agent",
      "plan",
      "build",
      "queue",
      "clear_queue",
    ]);
  });

  it("filters by command name prefix", () => {
    expect(getSlashCommandSuggestions("/mo").map((command) => command.name)).toEqual([
      "model",
      "mode",
    ]);
  });

  it("returns no suggestions for exact command names", () => {
    expect(getSlashCommandSuggestions("/plan")).toEqual([]);
  });

  it("returns no suggestions while command arguments are being typed", () => {
    expect(getSlashCommandSuggestions("/plan write tests")).toEqual([]);
  });
});

describe("formatSlashCommandCompletion", () => {
  it("formats selected command completion text", () => {
    expect(
      formatSlashCommandCompletion({
        name: "plan",
        usage: "/plan [prompt]",
        description: "Switch to plan agent",
      }),
    ).toBe("/plan ");
  });
});

describe("formatSlashCommandHelp", () => {
  it("groups visible commands by category", () => {
    const help = formatSlashCommandHelp(visibleSlashCommands);

    expect(help).toContain("Commands:");
    expect(help).toContain("Session:");
    expect(help).toContain("Model/Auth:");
    expect(help).toContain("/model [provider-id|status|reset] - List or switch AI models");
  });
});
