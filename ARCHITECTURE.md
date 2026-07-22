# ARCHITECTURE.md

## Runtime Shape
- Build the product as a Node.js and TypeScript coding assistant with a separable MAGI consensus core.
- Keep the assistant shell responsible for UX, sessions, tool execution, permissions, and file changes.
- Keep MAGI core responsible for shared history, review lenses, engine selection, votes, and consensus decisions.

## Bootstrap Architecture
- Start with a direct terminal process, not a daemon/server architecture.
- Use the Ink TUI as the bootstrap daily-driver shell, with SGR mouse support limited to transcript scrolling and tool/reasoning reveal; defer rich diff viewing and timeline branching until the session runner and safety boundaries are clearer.
- Use SQLite-backed append-only session events for persisted sessions, with draft sessions held in memory until the first successful assistant response.
- Implement a typed tool registry with `read`, `glob`, `grep`, `edit`, `write`, `apply_patch`, `bash`, `webfetch`, `websearch`, `todowrite`, `question`, `skill`, TypeScript/JavaScript LSP tools, `task`, and `plan_exit`.
- Use one primary model adapter for the normal loop; MAGI multi-engine foundations use configurable provider pools and remain gated behind explicit high-assurance workflows.
- Keep interfaces narrow so the bootstrap loop can later be replaced by a richer session runner.

## Main Components
- TUI shell: receives user input, displays status/session/model state, offers command selectors, renders transcript/tool/question overlays, and keeps the normal coding loop usable from the terminal.
- Session manager: stores conversation state, compact summaries, lifecycle events, tool settlements, todos, task updates, plan exits, and decision trails.
- Workspace adapter: resolves repo paths, reads files, searches content, and applies patches.
- Tool registry: exposes typed tools with input schemas, permission levels, and audit behavior.
- Permission policy: decides whether a tool call is allowed, denied, or requires user approval.
- Shell runner: executes commands, captures stdout/stderr/exit code, and handles long-running processes.
- Patch applier: applies controlled file edits and records changed paths.
- Verification runner: runs configured lint/typecheck/test/build commands when available.
- Subagent runner: launches foreground and background subagent tasks using the same agent loop while preventing nested task recursion.
- LSP adapter: launches `typescript-language-server` on demand for TypeScript/JavaScript document symbols, definitions, references, hover information, and call hierarchy.
- Websearch adapter: calls Exa and Parallel MCP endpoints plus Brave Search REST, normalizing results into agent-readable text under the existing network permission category.
- Sandbox runner: runs risky verification in an isolated environment when available.
- Model adapter layer: uses Vercel AI SDK for provider calls, streaming, structured outputs, and tool-capable model interactions.
- MCP integration layer: uses the official MCP SDK to connect external tools and expose MAGI tools where useful.
- MAGI consensus core: selects engines, builds shared history, injects review lenses, collects votes, and applies the consensus matrix.
- Audit store: persists enough data to reconstruct plans, diffs, logs, reviews, votes, and final decisions.

## Normal Agent Loop
See [`AI_LOOP.md`](./AI_LOOP.md) for a more detailed walkthrough of the current implementation.

1. Receive the user task.
2. Inspect high-value repo sources before guessing.
3. Produce a compact plan when the task is non-trivial.
4. Read and edit only relevant files.
5. Run focused verification when commands are known.
6. Feed failures back into the loop.
7. Revise until the task is complete or blocked.
8. Summarize changed files, verification results, and residual risks.

## Agent And Tool Loop
- Provider-native tool calls are preferred when the model supports them; JSON action fallback remains available for compatibility.
- Unknown or malformed native tool calls become explicit `invalid_tool` observations so the model can recover without hiding provider mistakes.
- Tool execution records pending, running, succeeded, failed, denied, and interrupted settlement states where applicable.
- The `plan` agent is read-only by default but may write or edit only its exact plan file under `.magi/plans/` during plan-mode workflow.
- The `task` tool supports foreground subagents for blocking research/work and background subagents for independent work that records `task_update` events.
- Background tasks require a saved session, write events to the session where they started, and deny prompt-gated permissions rather than blocking on interactive approval.

## MAGI Gate Triggers
- User explicitly asks for MAGI, consensus, deep review, or high-assurance validation.
- Planned change crosses multiple subsystems or packages.
- Diff touches auth, permissions, secrets, data migrations, infra, sandboxing, model routing, or command execution.
- Verification fails repeatedly and normal repair is not converging.
- The assistant is about to accept a large or risky final diff.

## MAGI Mode Loop
1. Capture requirement, current plan, diff or proposed change set, tool results, and verification logs.
2. Select an initiating engine with adaptive weighted roulette when a new plan/change set is needed.
3. Run build/tests in sandbox when available and bind logs into `sharedContextHistory`.
4. Assign dynamic review lenses to non-initiating engines.
5. Request structured reviews from reviewers using the same shared history.
6. Let the initiating engine revise or re-plan from the review evidence.
7. Request schema-bound final votes from all engines using the same append-only shared history.
8. Apply the consensus matrix exactly.
9. Continue, revise, reject, or ask the user depending on the decision.

## Tool System
- Tools must declare `name`, `description`, `inputSchema`, permission category, and execution behavior.
- Tool results must include success/error status, output or error text, and settlement timing where applicable.
- File writes and shell commands must be auditable.
- Destructive git operations, broad deletes, secret access, network actions, and external deployments require explicit approval.
- Read-only inspection should be low-friction, but still logged when it influences MAGI decisions.

## Permission Model
- Default to least privilege.
- Separate read, write, shell, network, git, and sandbox permissions.
- Deny destructive actions unless explicitly requested or approved.
- Never hide command output that affects a final decision.

## Reference Boundaries
- OpenCode, Pi, Cline, Aider, and OpenHands are references, not default forks.
- Reuse maintained TypeScript-native packages when they reduce non-MAGI infrastructure work.
- Keep consensus, shared-history voting, adaptive weighting, and dynamic lens injection as MAGI-owned logic.

## Foundation Dependencies
- Use AI SDK as the default model/provider/tool-call foundation.
- Use MCP SDK as the default external tool interoperability foundation.
- Use SDKs aggressively for portable infrastructure, but reject default dependencies that require a proprietary hosted control plane or make MAGI hard to self-host.
- Vercel AI SDK is acceptable as a library dependency; Vercel AI Gateway, deployment, and account-bound services must stay optional.
- MAGI-specific consensus, shared-history voting, adaptive weighting, and dynamic lens injection remain custom product logic.
