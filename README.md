# MAGI

MAGI is a local coding-agent CLI/TUI prototype. The current milestone is a self-hosting assistant shell with a usable Ink-based daily-driver interface: it can read files, search code, edit through controlled tools, run verification commands, use provider-native tool calls, persist session history, launch subagents, revise from failures, and summarize changes.

MAGI consensus and multi-engine review foundations are partially implemented, but the normal coding path is still the default bootstrap loop. See `ROADMAP.md` for the remaining MAGI trigger, sandbox, review, and voting work.

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

Plain-language agent prompts can use configured API-key providers or the built-in OpenAI Codex OAuth model catalog. The user-facing slash surface combines global commands such as `/model`, `/agent`, `/sessions`, and `/summary` with commands exposed by the active agent. File reads, search, LSP, web fetch/search, shell, and patch application run as agent tools.

The single-engine agent loop uses `agent.maxIterations` as a step budget. When it reaches the final step, tools are disabled and the model is asked to provide a final answer from the observations gathered so far instead of stopping with a hard error.

MAGI starts in a draft session by default. It creates a saved session only after the first normal prompt receives a successful assistant response. Set `session.startup` to `"resume"` to automatically resume the latest saved session for the current workspace. Background subagent tasks require a saved session so their lifecycle events cannot be written to the wrong draft.

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
/mode
/auth status
/auth login openai
/model
/model status
/agent
/plan
/build
/done
/queue
/clear_queue
/steer Use focused tests first
/interrupt
/revise
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
- The startup screen shows the active agent/model/session, key shortcuts, and quick paths for `/model`, `/agent`, and `/sessions`.
- The footer shows active run progress such as command, agent, phase, current model step, and current tool or verification command.
- The transcript is a bounded viewport with tail-follow behavior, PageUp/PageDown scrolling, `j`/`k` message selection, and Enter/Space expansion for collapsible messages.
- `/mode` shows the current MAGI mode, active agent, selected model provider, and session.
- `/auth` manages OpenAI OAuth credentials for built-in Codex-style OpenAI model providers.
- `/model` opens a selector when run without arguments; `/model status`, `/model reset`, and `/model <provider-id>` remain available.
- `/agent` opens a selector when run without arguments; `/agent <agent-id>` switches directly.
- `/help` includes the active agent's command surface first, followed by global commands.
- `/plan`, `/build`, and `/done` are user-facing active-agent commands, not global workflow stages.
- The plan agent exposes `/plan` and `/done`. It can write only its session plan file under `.magi/plans/` and can call `plan_exit` to ask whether to switch back to build mode.
- The build agent exposes `/plan`, `/build`, and `/done`.
- `/queue`, `/clear_queue`, `/steer`, and `/interrupt` control active or queued agent runs.
- Validation, verification, focused tests, and future harness suites are agent-invoked subprocesses/tools. Ask the active agent in plain language to validate, verify, or run tests.
- `/done` is a checkpoint: plan mode reports the plan file and next step, build mode summarizes the session.
- `/revise` asks the active agent to revise from recent verification failures.
- `/summary` reports changed files, verification results, and residual risk.
- File reads, search, LSP, web fetch/search, shell, and patch application are agent tools rather than user-facing slash commands; ask the agent in plain language to use them.
- Tool results render as concise cards with status, target paths, duration, output summaries, short collapsed previews, and expandable full detail for long output.
- Interactive `question` tool prompts support arrow-key option selection, Space marking, Enter submit, custom typed answers, and multi-select display.
- The agent loop supports provider-native tool calls and JSON fallback actions. Malformed native tool calls are converted into `invalid_tool` observations rather than being silently ignored.
- The `task` tool can launch foreground `general` and `explore` subagents. It can also launch background tasks with `background: true`; background tasks write `task_update` events and deny prompt-gated permissions instead of blocking on user input.
- MAGI starts in a draft session by default and saves it only after the first successful normal prompt.
- `/sessions` opens a selector for meaningful saved sessions; `/sessions all` includes empty and command-only legacy sessions.
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

The database is ignored by git. It contains sessions and append-only session events such as user messages, assistant messages, tool calls, tool settlements, permission decisions, verification results, todo updates, task updates, plan exits, context summaries, and summaries.

## AI Loop

For a readable walkthrough of the current prompt → model action → tool execution → observation → final answer flow, see [`AI_LOOP.md`](./AI_LOOP.md).

## Current Status

Phase 0 through Phase 3 are complete. Phase 3.5 runner/session/tool parity is complete for the current bootstrap scope: sessions, native tool calls, durable tool settlement, compaction, model/auth commands, plan/build agents, OpenCode-style planning tools, `webfetch`, `websearch`, `skill`, foreground/background `task`, invalid-tool handling, and TypeScript/JavaScript LSP tools including call hierarchy are implemented. Phase 4 multi-provider foundations and configurable MAGI engine selection are in place. Phase 4.5 TUI usability is complete for the Ink baseline: startup dashboard, status/footer affordances, transcript viewport, selectors, semantic message cards, concise tool cards, and interactive question prompts are implemented. Plugin/custom tool registry work is deferred until sandbox and permission boundaries are clearer.
