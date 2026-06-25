# SPEC.md

## Product Goal
- MAGI is an OpenCode-style coding assistant enhanced with selective heterogeneous multi-LLM review.
- The product should feel like a fast local coding agent by default, with MAGI consensus available when work is risky.
- MAGI improves coding agents by adding structured self-doubt, runtime evidence, and cross-engine review at decision points.

## Bootstrap MVP
- Build the smallest CLI agent that can work on this repository.
- Required: prompt input, model call, file read/search, patch application, shell command execution, verification feedback, and final summary.
- Not required: TUI, daemon, plugin system, multi-engine consensus, sandbox isolation, persistent database, IDE integration, or CI mode.
- The bootstrap agent should be good enough to implement the next roadmap phase with human supervision.

## Target Users
- Developers who want a terminal-first coding assistant that can inspect repos, edit files, run commands, fix failures, and explain results.
- Teams that want higher assurance for security-sensitive, multi-file, infrastructure, or repeated-failure coding tasks.

## Product Modes
- Normal Mode: a responsive single-primary-agent loop for everyday coding tasks.
- MAGI Mode: a high-assurance loop that adds sandbox evidence, dynamic review lenses, and schema-bound multi-engine voting.
- The assistant should enter MAGI Mode for risky plans, large diffs, security/auth/data/infra changes, repeated test failures, or explicit user requests.

## MVP Scope
- Node.js and TypeScript implementation.
- Terminal-first interactive coding assistant.
- Model/provider access through Vercel AI SDK.
- MCP SDK integration for external tool interoperability.
- Project/session initialization.
- Repo inspection through file search, content search, and targeted reads.
- File editing through controlled patch application.
- Shell command execution with permission checks.
- Git-aware workflow that can inspect status/diff/log without destructive defaults.
- Normal coding loop: plan, edit, run tools, observe failures, revise, summarize.
- Configurable verification commands once project manifests exist.
- MAGI review gate for selected tasks or final diffs.
- Shared context history containing requirement, plan, diff, tool results, logs, reviews, revisions, and votes.
- Structured review and vote outputs suitable for audit and replay.

## Non-Goals For MVP
- Forking OpenCode.
- Designing a custom provider abstraction that duplicates AI SDK.
- Designing a custom external tool protocol that duplicates MCP.
- Full IDE extension.
- Cloud multi-user service.
- Custom package marketplace.
- Automatic merge or commit by default.
- Permanent model personas.
- Full CI/PR product surface.
- Replacing all agent logic with a third-party framework.

## Core Requirements
- Preserve a fast normal coding path; do not run multi-engine consensus for every trivial request.
- Prefer SDK reuse over bespoke infrastructure, but keep the core portable and avoid default dependencies on proprietary hosted services.
- Use Vercel AI SDK as an open-source TypeScript library only; Vercel-hosted services and AI Gateway must remain optional adapters, not required runtime infrastructure.
- Keep MAGI consensus deterministic where possible: schemas, explicit logs, explicit decisions, and reproducible decision trails.
- Runtime failures must be fed back into the active loop before asking models to re-evaluate.
- Review lenses must be dynamic parameters, not permanent system prompts or fixed personas.
- Consensus must not use majority-rule shortcuts: `2 APPROVE / 1 REJECT` is `DEADLOCK`.
- Risky changes must not be auto-accepted without unanimous approval.

## Success Criteria
- Bootstrap success: the assistant can make supervised edits to this repo, run verification, revise from failures, and summarize results.
- The assistant can complete small local coding tasks end-to-end in Normal Mode.
- The assistant can run verification commands and revise from failures.
- MAGI Mode can evaluate a plan or diff using shared history, dynamic lenses, and structured votes.
- Every MAGI decision can be reconstructed from saved inputs, logs, reviews, and votes.
- The core remains portable enough to run from a terminal assistant, local service, or future CI/PR gate.

## Open Questions
- Which model providers are supported in the first implementation pass.
- Whether sandbox execution starts as local Docker only or includes a remote backend later.
- How much UI is needed beyond a terminal command loop for the first usable build.
