#!/usr/bin/env node

const lines = [
  "MAGI OpenTUI migration baseline",
  "",
  "The default daily-driver TUI is still:",
  "  pnpm --filter @magi/tui start",
  "",
  "OpenTUI native rendering is experimental and uses a small Node ESM loader shim",
  "for @opentui/react's react-reconciler/constants import.",
  "If OpenTUI core native FFI is unavailable, the native command exits gracefully",
  "with an explanatory message instead of crashing.",
  "",
  "Current migration work completed:",
  "  - OpenTUI dependencies installed",
  "  - shared key adapter added",
  "  - prompt-state extracted",
  "  - shared transcript formatting and state extracted",
  "  - OpenTUI Composer, CommandSuggestions, and Transcript prototypes added",
  "  - OpenTUI session boot fallback extracted and tested",
  "",
  "To retry native rendering:",
  "  pnpm --filter @magi/tui start:opentui:native",
];

process.stdout.write(`${lines.join("\n")}\n`);
