# MAGI

MAGI is a local coding-agent CLI/TUI prototype. The current milestone is a self-hosting assistant shell that can read files, run simple tools, persist session history, execute verification commands, and summarize changes.

MAGI consensus and multi-engine review are intentionally not part of the current bootstrap loop yet. See `ROADMAP.md` for planned phases.

## Requirements

- Node.js `>=22`
- pnpm `10.33.4`

## Install

```sh
pnpm install
```

This repo uses `better-sqlite3`, which needs a native build. `pnpm-workspace.yaml` allows the required build scripts for `better-sqlite3` and `esbuild`. If SQLite bindings are missing after install, rebuild the package:

```sh
pnpm --filter @magi/core rebuild better-sqlite3
```

## Configuration

MAGI looks for config at either:

- `magi.config.json`
- `.magi/config.json`

Example:

```json
{
  "modelProviders": [
    {
      "id": "primary",
      "provider": "openai",
      "model": "gpt-4.1-mini",
      "apiKeyEnv": "OPENAI_API_KEY"
    }
  ],
  "permissions": {
    "read": "allow",
    "write": "prompt",
    "shell": "prompt",
    "network": "prompt"
  },
  "verificationCommands": ["pnpm typecheck", "pnpm test", "pnpm lint", "pnpm knip"]
}
```

General LLM prompts require a configured model provider and matching API key environment variable. Slash commands such as `/read`, `/glob`, `/grep`, `/verify`, and `/summary` can be useful without an API key.

## Run MAGI

Build all workspaces first:

```sh
pnpm build
```

Run the built TUI app:

```sh
pnpm --filter @magi/tui start
```

For source execution during debugging, use:

```sh
pnpm --filter @magi/tui start:tsx
```

## Development

Run incremental TypeScript build watchers for all workspaces:

```sh
pnpm dev
```

`pnpm dev` does not run the TUI. It watches and emits package-local `dist/` output. Use a second terminal to run the built TUI:

```sh
pnpm --filter @magi/tui start
```

Build once:

```sh
pnpm build
```

Typecheck:

```sh
pnpm typecheck
```

Run tests:

```sh
pnpm test
```

Lint:

```sh
pnpm lint
```

Check formatting:

```sh
pnpm format:check
```

Format files:

```sh
pnpm format
```

Check unused dependencies and exports:

```sh
pnpm knip
```

Run the combined local check:

```sh
pnpm check
```

## TUI Commands

Inside the TUI:

```txt
/help
/read ROADMAP.md
/glob **/*.ts
/grep Phase ROADMAP.md
/bash pnpm test
/apply_patch path/to/change.patch
/verify
/summary
```

Notes:

- Plain text input is sent to the primary model adapter.
- `/read`, `/glob`, and `/grep` are read tools.
- `/bash` is a shell tool and follows the configured shell permission policy.
- `/apply_patch` applies a `git apply` compatible patch file and follows the configured write permission policy.
- `/verify` runs configured verification commands.
- `/summary` reports changed files, verification results, and residual risk.

## Workspace Layout

```txt
apps/tui          Ink-based terminal UI
packages/config  Workspace config loading and validation
packages/core    Model adapter, session store, builtin tools, summary logic
packages/harness Verification command execution and result capture
```

## Runtime Data

MAGI stores local session history in:

```txt
.magi/magi.db
```

The database is ignored by git. It contains sessions and append-only session events such as user messages, assistant messages, tool calls, permission decisions, verification results, and summaries.

## Current Status

Phase 0 and Phase 1 are complete. The next major focus is Phase 2: verification feedback loop, where command failures should be captured and used to revise MAGI's own code changes.
