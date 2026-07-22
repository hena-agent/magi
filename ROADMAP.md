# ROADMAP.md

## Status Legend
- `[x]` Done.
- `[ ]` Not started.
- `[~]` In progress or partially done.

## Current Focus
- [x] Finish bootstrap self-hosting through Phase 3 MAGI core and Phase 3.5 session/runner parity basics.
- [x] Finish remaining Phase 3.5 OpenCode-style tool parity before moving deeper into Phase 4 multi-engine support.
- [ ] Next recommended implementation target: start Phase 4 model adapter work, or design sandbox/permission boundaries before plugin/custom tool registry.

## Phase 0: Project Skeleton
- [x] Initialize pnpm workspace.
- [x] Initialize Node.js and TypeScript project structure.
- [x] Add Turborepo task runner.
- [x] Add formatting, linting, typechecking, and test commands.
- [x] Add Biome configuration.
- [x] Add Knip unused dependency/export checks.
- [x] Add Vitest test harness.
- [x] Add minimal `apps/tui` entrypoint.
- [x] Add `packages/core`, `packages/config`, and `packages/harness` skeletons.
- [x] Make root `pnpm dev` run incremental workspace build watchers.
- [x] Update `AGENTS.md` with exact commands once they exist.
- [x] Add AI SDK dependencies for primary model calls.
- [x] Add MCP SDK dependency for future tool interoperability.
- [x] Add config loading for model providers, permissions, and verification commands.

## Phase 1: Self-Hosting Agent Shell
- [x] Implement interactive prompt input in the TUI shell.
- [x] Add one primary model adapter through AI SDK.
- [x] Add minimal builtin tools: `read`, `glob`, `grep`, `apply_patch`, and `bash`.
- [x] Add simple permission prompts for write and shell actions.
- [x] Store session events as JSONL or another simple local format.
- [x] Run verification commands manually or from config.
- [x] Summarize changed files, verification results, and residual risks.
- [x] Use this agent to make subsequent changes to the MAGI repo.

## Bootstrap Completion Checklist
- [x] A user can run MAGI in this repo and complete a small supervised coding task.
- [x] The assistant can inspect files, apply patches, run shell commands, and summarize changed files.
- [x] The assistant can capture command failures and use them to revise its own code changes.
- [ ] No daemon, plugin system, sandbox, or MAGI consensus is required for bootstrap completion.

## Phase 2: Verification Feedback Loop
- [x] Detect or configure project verification commands.
- [x] Run focused lint/typecheck/test/build commands.
- [x] Capture stdout, stderr, exit code, and duration.
- [x] Feed failures back into the agent loop.
- [x] Store verification events in the session history.
- [x] The assistant can use test/build/lint failures to revise its own code changes.

## Phase 3: MAGI Core
- [x] Implement `sharedContextHistory` builder.
- [x] Implement dynamic review lens definitions.
- [x] Implement review request and response validation.
- [x] Implement vote response validation.
- [x] Implement the consensus matrix exactly.
- [x] Persist decision trails for replay and HITL review.

## Phase 3.5: OpenCode-Style Runner And Session Parity
- [x] Start TUI sessions in draft mode and persist only after the first successful normal prompt.
- [x] Add saved session listing, resume, rename, history, and fresh draft reset commands.
- [x] Inject recent saved session history into normal agent turns.
- [x] Replace hard max-iteration stop with a final text-only response step.
- [x] Filter empty and command-only legacy sessions from the default session list.
- [x] Replace the fixed JSON action loop with an event-driven continuation loop based on pending tool results and queued user input.
- [x] Persist typed agent step lifecycle events such as step started, assistant started, step ended, provider error, and interruption.
- [x] Move from JSON text actions toward provider-native tool calls through the AI SDK tool interface.
- [x] Add durable tool settlement states for pending, running, succeeded, failed, denied, and interrupted tools.
- [x] Add context compaction with summary events, recent-context retention, tool-output truncation, and overflow recovery.
- [x] Add background session maintenance for generated titles, summaries, and cleanup of legacy empty sessions.
- [x] Add queued and steering input handling while an agent run is active.
- [x] Propagate cancellation through model, tool, verification, OAuth, catalog, and background task operations with graceful process shutdown.
- [x] Reconcile resumed assistant streams, final responses, tool settlements, active agents, and removed model providers without corrupting transcript state.
- [x] Add OpenCode-style tool parity in the real agent loop, not only as slash commands.
  - [x] Add core/native/JSON/TUI loop support for `webfetch`, `todowrite`, and `question`.
  - [x] Upgrade `question` from output-only prompts to interactive TUI question answering with tool-result continuation.
  - [x] Upgrade `todowrite` from output-only updates to persisted session todo state and resume display.
  - [x] Harden `webfetch` toward OpenCode behavior with better markdown conversion, media handling, response truncation metadata, and network permission UX.
  - [x] Add `skill` tool with workspace and user skill discovery, loading, and permission checks.
  - [x] Add foreground `task` tool for `general` and `explore` subagents using the existing agent runner.
  - [x] Add background `task` execution after foreground subagent behavior is stable.
  - [x] Add `plan_exit` plus OpenCode `plan-mode.txt` workflow, plan file path management, and plan-file-only write exceptions.
  - [x] Add LSP tool support for TypeScript/JavaScript document symbols, definitions, references, and hover.
  - [x] Add LSP call hierarchy after the first LSP tool pass is stable.
  - [x] Add `websearch` with Exa, Parallel, and Brave provider selection, API key handling, and network permission prompts.
  - [x] Add internal invalid-tool handling for malformed provider tool calls.
  - [x] Defer plugin/custom tool registry until sandbox and permission boundaries are designed.
- [x] Add tests that cover draft session persistence, continuation conditions, max-step final response, and context compaction behavior.
  - [x] Add focused tests for native task background flag parsing.
  - [x] Add focused tests for continuation queued input, stale queued input, and settled-tool completion.
  - [x] Add focused tests for max-step final text-only response behavior.
  - [x] Add focused tests for resumed context including todos, task updates, and plan exits.
  - [x] Add TUI-level coverage for draft session persistence.
  - [x] Add deterministic controller coverage for permission-gated tools, queued input, persistence, and startup resume.
  - [x] Add cancellation coverage for in-flight and non-cooperative models, process trees, shutdown ordering, and interrupted replay.

## Phase 4: Multi-Engine Support
- [x] Implement model adapter interface.
- [x] Add Claude-family adapter.
- [x] Add GPT-family adapter.
- [x] Add Gemini-family adapter.
- [x] Add Models.dev catalog loading and known-provider projection.
- [x] Add MAGI GPT/Claude/Gemini engine readiness selection.
- [ ] Implement adaptive weighted initiator selection.
- [ ] Implement reward/penalty updates from sandbox and vote outcomes.

## Phase 4.5: TUI Usability And Daily-Driver UX
- [x] Rework the Ink TUI from a raw log view into a usable assistant interface.
- [x] Split the view into status bar, transcript/timeline, overlays, composer, command suggestions, and footer.
- [x] Replace plain string display messages with semantic user, assistant, tool, status, error, and system message cards.
- [x] Add transcript viewport behavior with bounded height, tail follow, and scroll controls.
- [x] Improve composer editing with cursor movement, prompt history, and common shortcuts such as Ctrl+A, Ctrl+E, Ctrl+U, and Ctrl+W.
- [x] Add slash command palette behavior with selection, Tab completion, and command categories.
- [x] Make permission prompts modal-like with tool-specific summaries and clear allow/deny affordances.
- [x] Improve question prompts with option selection, custom answers, and multi-select handling.
- [x] Render tool activity as concise cards with status, changed paths, command summaries, and collapsed long output.
- [x] Add visible running state for thinking, active tool, queued prompts, permissions, and background tasks.
- [x] Establish Ink as the production TUI renderer, add scoped transcript wheel/click support, and defer rich diff viewing and timeline branching until the daily-driver loop is stable.

## Phase 5: Assistant Integration
- [ ] Add MAGI trigger policy for risky work.
- [ ] Insert gates after plan creation, before large diffs, after repeated failures, and before accepting risky final changes.
- [ ] Allow explicit user commands to enter or skip MAGI Mode.
- [ ] Ensure Normal Mode remains fast for simple edits.

## Phase 6: Sandbox And Safety
- [ ] Add local sandbox or Docker-based verification path.
- [ ] Isolate high-risk command execution when possible.
- [ ] Add stricter approval requirements for destructive filesystem, git, network, and deployment actions.
- [ ] Package code, logs, reviews, and votes for HITL review on `DEADLOCK`.

## Phase 7: Reuse And Extensions
- [ ] Research OpenCode, Pi, Cline, Aider, and OpenHands before building common agent infrastructure.
- [ ] Prefer maintained TypeScript-native packages for non-MAGI foundations.
- [ ] Prefer portable SDKs over custom infrastructure, but avoid adopting packages that require proprietary hosted services for core functionality.
- [ ] Keep Vercel-hosted AI Gateway/deployment paths optional even if using Vercel AI SDK locally.
- [ ] Evaluate Pi packages for permissions, sandboxing, subagents, MCP, repo awareness, review UX, and context efficiency before rewriting.
- [ ] Keep MAGI consensus logic independent and reusable.

## Phase 8: Future Product Surfaces
- [ ] Add CI/PR gate mode using the same MAGI core.
- [ ] Add local service mode for editor or web integrations.
- [ ] Add richer terminal UI after the core loop is stable.
- [ ] Add team policy configuration for approval thresholds and risk triggers.

## Product MVP Completion Checklist
- [x] A user can run MAGI in a repo and complete a small coding task.
- [x] The assistant can edit files through patches and run verification commands.
- [x] Failures are captured and used for revision.
- [ ] MAGI Mode can review a plan or diff with structured reviews and votes.
- [ ] `PASS`, `DEADLOCK`, `FAIL`, and `REJECT` are handled according to the matrix.
- [ ] Decision trails are saved with enough detail for human review.
