# AGENTS.md

## Product Concept
- MAGI is an OpenCode-style coding assistant enhanced with heterogeneous multi-LLM decision and review loops.
- The default product is an interactive coding agent: inspect the repo, edit files, run commands, fix failures, and summarize results.
- MAGI consensus is a selective high-assurance mode for risky plans, multi-file changes, security-sensitive edits, repeated test failures, or explicit user requests.
- Optimize normal coding flow for responsiveness, but optimize MAGI mode for defect prevention, security, and consensus quality.

## Bootstrap Priority
- The first milestone is a rough self-hosting CLI agent that can develop this repo; that bootstrap path is now mostly complete through the normal single-engine coding loop.
- Continue prioritizing Phase 3.5 runner/session/tool parity before deeper multi-engine work.
- Defer daemon mode, plugin systems, sandbox isolation, and CI/PR gates until LSP/websearch/custom tool boundaries are better understood.
- Prefer the smallest working loop over architectural completeness.

## Reference Strategy
- Do not fork OpenCode by default; study it as a reference for terminal UX, tool permissions, config, agents, LSP/MCP integration, plugins, custom tools, and project `AGENTS.md` initialization.
- Study Pi as a reference for a small extensible coding-agent core with TypeScript extensions, skills, prompt templates, themes, SDK/RPC/JSON event modes, and package distribution.
- Study Cline for SDK/CLI/IDE architecture, Plan/Act mode, approval checkpoints, MCP/plugin hooks, headless automation, and shared agent-core product surfaces.
- Study Aider for terminal pair-programming UX, repo maps, git-first edits, edit formats, and lint/test repair loops.
- Study OpenHands for sandboxed agent backends, remote execution, agent servers, Docker/VM isolation, and automation integrations.
- Before building common agent capabilities, check whether Pi packages or other maintained packages already cover them; prefer integration or adaptation over rewriting.
- Treat third-party packages as untrusted code: inspect source, license, maintenance status, and sandbox/permission behavior before adopting them.
- Keep MAGI-specific consensus, shared-history voting, adaptive weighting, and dynamic lens injection as first-class product logic, not a thin wrapper around another agent.

## Core Principle
- Do not implement fixed personas such as "architect agent" or "security agent".
- Keep each LLM engine neutral by default.
- Inject review lenses only just-in-time as parameters during review or voting.
- Use differences between Claude, GPT, and Gemini as heterogeneous engines; do not simulate diversity through roleplay.

## Engine Heuristics
- Claude-family engines are expected to be strong at structural consistency, constraint following, and risk analysis.
- GPT-family engines are expected to be strong at fast implementation, library use, and production-oriented code generation.
- Gemini-family engines are expected to be strong at large-context dependency analysis and multi-file reasoning.
- Treat these as routing heuristics, not hardcoded personalities.

## Control Flow
- Normal mode: use a fast primary coding loop of plan, edit, run tools, observe failures, revise, and report.
- Plan mode: use the `plan` agent for read-only planning. It may write only the exact `.magi/plans/<session-id>.md` plan file, then call `plan_exit` to ask whether to switch to `build`.
- Subagent tasks: use foreground `task` for blocking research/work and background `task` only when the result can be recorded asynchronously as `task_update` events without blocking the parent loop.
- MAGI mode Phase 1: select the initiating engine by adaptive weighted roulette.
- MAGI mode Phase 2: have the initiating engine produce one atomic plan or change set.
- MAGI mode Phase 3: run build/tests in an isolated sandbox such as Docker when available.
- MAGI mode Phase 4: inject runtime logs and dynamic review perspectives into the non-initiating engines.
- MAGI mode Phase 5: bind requirement, plan, diff, logs, reviews, and revisions into one shared history for final voting.
- MAGI mode Phase 6: apply the consensus matrix without majority-rule shortcuts.

## Assistant Integration
- Insert MAGI gates at decision points, not around every trivial action.
- Useful gate points: after plan creation, before applying large diffs, after repeated test failures, and before final acceptance of risky work.
- Keep MAGI core separate from the assistant shell so it can later run as a CI/PR gate.
- If this repo imports or adapts OpenCode/Pi concepts, preserve proven tool, permission, terminal, session, and patch workflows unless MAGI needs a specific hook.

## Reuse Candidates
- For permissions/sandboxing, research OpenCode permissions and Pi packages such as permission modes, access-denied, permission-system, and landlock-style sandboxing.
- For multi-agent orchestration, research Pi subagent/workflow packages before implementing custom delegation.
- For web/research tools, research Pi web-access and MCP adapter packages before adding bespoke integrations.
- For repo awareness and context efficiency, research codebase-awareness, LSP/linter, context compression, and session-memory packages before building custom tools.
- For review UX, research local review, second-opinion, plan annotation, and changed-code review packages before implementing MAGI review surfaces.

## Dynamic Review Lenses
- Architecture lens: coupling, boundaries, responsibility leaks, layer violations.
- Security lens: secrets, authn/authz gaps, unsafe inputs, OWASP-style risks.
- Performance lens: complexity, I/O bottlenecks, unnecessary calls, scalability risks.
- Add lenses as structured parameters, not permanent system prompts.

## Sandbox Validation
- Natural-language debate is not enough for multi-file code changes.
- Always feed build/test failures and tracebacks back into `sharedContextHistory`.
- Runtime errors should become objective alignment targets for the next loop.

## Shared Context Voting
- Voting engines receive the same append-only `sharedContextHistory`.
- The initiating engine must also vote from this shared record.
- Votes are schema-bound decisions: `APPROVE` or `REJECT`, with confidence, risk/efficiency metrics, and technical justification.

## Consensus Matrix
- `3 APPROVE`: `PASS`; accept the plan/change or continue the coding loop.
- `2 APPROVE / 1 REJECT`: `DEADLOCK`; ask the user or package code, logs, and discussion for HITL review.
- `1 APPROVE / 2 REJECT`: `FAIL`; revise within the active task loop while under max iterations, otherwise reject.
- `0 APPROVE`: `REJECT`; abandon the current approach and re-plan from another initiating engine.

## Adaptive Weighting
- Start Claude, GPT, and Gemini with equal initiator weights.
- Increase an initiator's weight when its change passes sandbox validation and peer approval.
- Decrease weight on failed tests or rejections.
- Keep a minimum weight floor so no engine is permanently eliminated.

## Implementation Stack
- Build MAGI with Node.js and TypeScript by default.
- Use Vercel AI SDK (`ai` and provider packages) for model calls, streaming, structured output, and tool calling unless a provider requires a direct adapter.
- Treat Vercel AI SDK as a portable open-source library; do not make Vercel-hosted services, AI Gateway, deployment, or account features part of the default architecture.
- Use the official MCP SDK for MCP client/server interoperability instead of inventing a custom external tool protocol.
- Actively reuse SDKs and maintained packages when they speed up the bootstrap, but avoid open-source dependencies that create avoidable vendor lock-in or require a proprietary hosted control plane.
- Prefer TypeScript-native libraries and package ecosystems before adding polyglot services.
- Keep MAGI core portable enough to run from a terminal assistant, local service, or future CI/PR gate.

## Implementation Notes
- Keep the harness backend deterministic where possible; do not use another LLM as a central operator.
- Store the full decision trail so HITL review can inspect final diff, sandbox logs, review feedback, and votes.
- Do not auto-accept risky changes without unanimous approval.

## Development Commands
- Install dependencies: `pnpm install`
- Run incremental build watchers for all workspaces: `pnpm dev`
- Run the built TUI app after building: `pnpm --filter @magi/tui start`
- Build all workspaces: `pnpm build`
- Typecheck all workspaces: `pnpm typecheck`
- Run tests: `pnpm test`
- Run Biome lint: `pnpm lint`
- Run Biome format check: `pnpm format:check`
- Format files: `pnpm format`
- Run combined local checks: `pnpm check`
- Run unused dependency/export checks: `pnpm knip`
- Sandbox execution: not configured yet.
