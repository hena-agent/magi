# MAGI

MAGI is a local coding-agent CLI/TUI prototype. The current milestone is a self-hosting assistant shell that can read files, run simple tools, persist session history, execute verification commands, revise from failures, and summarize changes.

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
  "verificationCommands": ["pnpm typecheck", "pnpm test", "pnpm lint", "pnpm knip"],
  "agent": {
    "maxIterations": 30
  },
  "session": {
    "startup": "new"
  }
}
```

DeepSeek can be configured directly. MAGI uses DeepSeek through its OpenAI-compatible API and defaults `baseUrl` to `https://api.deepseek.com` when omitted:

```json
{
  "modelProviders": [
    {
      "id": "primary",
      "provider": "deepseek",
      "model": "deepseek-v4-pro",
      "apiKeyEnv": "DEEPSEEK_API_KEY"
    }
  ]
}
```

Custom OpenAI-compatible endpoints can use `provider: "custom"` with an explicit `baseUrl`:

```json
{
  "modelProviders": [
    {
      "id": "primary",
      "provider": "custom",
      "model": "your-model-name",
      "apiKeyEnv": "CUSTOM_API_KEY",
      "baseUrl": "https://example.com/v1"
    }
  ]
}
```

Plain-language agent prompts require a configured model provider and matching API key environment variable. Slash commands such as `/read`, `/glob`, `/grep`, `/verify`, and `/summary` can be useful without an API key.

The single-engine agent loop uses `agent.maxIterations` as a step budget. When it reaches the final step, tools are disabled and the model is asked to provide a final answer from the observations gathered so far instead of stopping with a hard error.

MAGI starts in a draft session by default. It creates a saved session only after the first normal prompt receives a successful assistant response. Set `session.startup` to `"resume"` to automatically resume the latest saved session for the current workspace.

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
/sessions
/sessions all
/resume 1
/new
/rename Better session title
/history 20
```

Notes:

- Plain text input runs a single-engine agent turn that can read/search files, run verification, and propose patches.
- `/read`, `/glob`, and `/grep` are read tools.
- `/bash` is a shell tool and follows the configured shell permission policy.
- `/apply_patch` applies a `git apply` compatible patch file and follows the configured write permission policy.
- `/verify` runs configured verification commands.
- `/summary` reports changed files, verification results, and residual risk.
- MAGI starts in a draft session by default and saves it only after the first successful normal prompt.
- `/sessions` lists meaningful saved sessions with display titles, event counts, and IDs; `/sessions all` includes empty and command-only legacy sessions.
- `/resume <id-or-number>` switches sessions, and `/new` resets to a fresh draft session.
- `/rename <title>` updates the current session title and `/history [limit]` shows recent raw session events.

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

Phase 0 through Phase 3 are complete. The TUI now includes a default single-engine agent turn loop for normal prompts while MAGI consensus remains available as core infrastructure and preview/debug commands.
