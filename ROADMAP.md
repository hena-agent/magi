# ROADMAP.md

## Status Legend
- `[x]` Done.
- `[ ]` Not started.
- `[~]` In progress or partially done.

## Current Focus
- [~] Finish Phase 0 project skeleton so every later feature has a reliable TypeScript, Turbo, lint, test, and dead-code harness.
- [ ] Start Phase 1 only after Phase 0 remaining SDK/config tasks are complete.
- [ ] Do not start MAGI Core until Phase 2 can revise this repo from verification failures.

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
- [x] Make root `pnpm dev` run the TUI in watch mode.
- [x] Update `AGENTS.md` with exact commands once they exist.
- [ ] Add AI SDK dependencies for primary model calls.
- [ ] Add MCP SDK dependency for future tool interoperability.
- [ ] Add config loading for model providers, permissions, and verification commands.

## Phase 1: Self-Hosting Agent Shell
- [ ] Implement interactive prompt input in the TUI shell.
- [ ] Add one primary model adapter through AI SDK.
- [ ] Add minimal builtin tools: `read`, `glob`, `grep`, `apply_patch`, and `bash`.
- [ ] Add simple permission prompts for write and shell actions.
- [ ] Store session events as JSONL or another simple local format.
- [ ] Run verification commands manually or from config.
- [ ] Summarize changed files, verification results, and residual risks.
- [ ] Use this agent to make subsequent changes to the MAGI repo.

## Bootstrap Completion Checklist
- [ ] A user can run MAGI in this repo and complete a small supervised coding task.
- [ ] The assistant can inspect files, apply patches, run shell commands, and summarize changed files.
- [ ] The assistant can capture command failures and use them to revise its own code changes.
- [ ] No daemon, plugin system, sandbox, or MAGI consensus is required for bootstrap completion.

## Phase 2: Verification Feedback Loop
- [ ] Detect or configure project verification commands.
- [ ] Run focused lint/typecheck/test/build commands.
- [ ] Capture stdout, stderr, exit code, and duration.
- [ ] Feed failures back into the agent loop.
- [ ] Store verification events in the session history.
- [ ] The assistant can use test/build/lint failures to revise its own code changes.

## Phase 3: MAGI Core
- [ ] Implement `sharedContextHistory` builder.
- [ ] Implement dynamic review lens definitions.
- [ ] Implement review request and response validation.
- [ ] Implement vote response validation.
- [ ] Implement the consensus matrix exactly.
- [ ] Persist decision trails for replay and HITL review.

## Phase 4: Multi-Engine Support
- [ ] Implement model adapter interface.
- [ ] Add Claude-family adapter.
- [ ] Add GPT-family adapter.
- [ ] Add Gemini-family adapter.
- [ ] Implement adaptive weighted initiator selection.
- [ ] Implement reward/penalty updates from sandbox and vote outcomes.

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
- [ ] A user can run MAGI in a repo and complete a small coding task.
- [ ] The assistant can edit files through patches and run verification commands.
- [ ] Failures are captured and used for revision.
- [ ] MAGI Mode can review a plan or diff with structured reviews and votes.
- [ ] `PASS`, `DEADLOCK`, `FAIL`, and `REJECT` are handled according to the matrix.
- [ ] Decision trails are saved with enough detail for human review.
