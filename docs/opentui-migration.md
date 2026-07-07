# OpenTUI Migration Plan

## Purpose

MAGI should move the terminal UI from Ink to OpenTUI because the current TUI is becoming hard to evolve safely. The immediate goal is not a visual redesign. The goal is to regain implementation control while preserving the current daily-driver behavior.

OpenTUI is a better long-term fit for MAGI because it provides terminal-native primitives that match the product direction:

- Scrollable transcript regions.
- Rich keyboard and paste handling.
- Input, textarea, and select controls.
- Code, line-number, and diff renderables.
- Resize-aware layouts.
- Mouse selection support for later phases.
- A renderer used by OpenCode in production.

The migration must avoid a big-bang rewrite. The current TUI already contains important product behavior: sessions, draft persistence, command handling, agent execution, permission prompts, question prompts, selectors, prompt queueing, transcript selection, and tool cards. Losing any of that would be a regression.

## Current State

The current app is under `apps/tui`.

Important files:

- `apps/tui/src/index.tsx`: starts the Ink renderer with `render(<App />)`.
- `apps/tui/src/app.tsx`: returns `AppController`.
- `apps/tui/src/app-controller.tsx`: owns most runtime behavior.
- `apps/tui/src/app-view.tsx`: composes the view.
- `apps/tui/src/transcript-view.tsx`: formats and renders transcript lines.
- `apps/tui/src/composer.tsx`: renders the prompt line.
- `apps/tui/src/overlays.tsx`: renders permission, question, and selector overlays.
- `apps/tui/src/command-suggestions.tsx`: renders slash command suggestions.
- `apps/tui/src/draft-session.ts`: contains renderer-independent draft session helpers.

The current package dependencies include `ink` and `react` in `apps/tui/package.json`.

The main structural problem is that `app-controller.tsx` is a very large React component that owns too many responsibilities:

- Terminal input handling through Ink `useInput`.
- Prompt editing and cursor movement.
- Prompt history.
- Slash command parsing and execution.
- Model and agent selection flows.
- Session loading, draft events, and session persistence.
- Agent turn execution.
- Tool execution, permission checks, and settlement recording.
- Interactive `question` tool state.
- Selector overlay state.
- Transcript state, selection, expansion, and manual scroll slicing.
- Active run status and run visualization.
- Busy state and queued prompts.

Replacing Ink with OpenTUI without separating these responsibilities would only move the same complexity into a different renderer.

## Migration Principle

Separate product behavior from terminal rendering first.

The target shape is:

```txt
OpenTUI entrypoint
  ↓
OpenTUI React components
  ↓
TUI controller hook/service
  ↓
Renderer-independent state and actions
  ↓
Core agent runner, session store, tools, harness
```

The renderer should be responsible for:

- Displaying the current view state.
- Capturing keyboard, paste, resize, and later mouse events.
- Calling controller actions.

The controller should be responsible for:

- Translating UI actions into product behavior.
- Running agents and tools.
- Updating session and transcript state.
- Maintaining pending permission, question, selector, and queue state.

The core packages should remain renderer-agnostic.

## Recommended Dependency Direction

Use OpenTUI React rather than the low-level OpenTUI core API for the first migration pass.

Expected dependencies:

- `@opentui/core`
- `@opentui/react`
- `react`

Keep `ink` temporarily during the migration if the old UI and new UI need to coexist behind separate entrypoints. Remove `ink` only after the OpenTUI app can handle the normal daily-driver flow.

OpenTUI React uses JSX intrinsic elements such as:

- `<box>`
- `<text>`
- `<scrollbox>`
- `<input>`
- `<textarea>`
- `<select>`
- `<code>`
- `<line-number>`
- `<diff>`

The `apps/tui/tsconfig.json` may need `jsxImportSource: "@opentui/react"` and compatible module settings if OpenTUI React types require it.

## Phased Plan

### Phase 0: Document The Migration

Status: this document.

Goals:

- Record the reason for the renderer change.
- Record the current risk areas.
- Define safe migration phases and acceptance checks.

Done when:

- This document exists under `docs/`.
- Future work can reference this plan instead of rediscovering the same context.

### Phase 1: Add OpenTUI Baseline

Goal: prove OpenTUI can boot in this repo without touching the agent loop.

Tasks:

- Add `@opentui/core` and `@opentui/react` to `apps/tui`.
- Create an OpenTUI renderer entrypoint using `createCliRenderer()` and `createRoot(renderer).render(<App />)`.
- Render a minimal MAGI boot screen.
- Keep the old Ink entrypoint available if needed for fallback.

Acceptance checks:

- `pnpm --filter @magi/tui typecheck` passes or only exposes expected OpenTUI typing work.
- `pnpm --filter @magi/tui build` passes.
- The OpenTUI app starts and exits cleanly.

Risks:

- OpenTUI native package loading may behave differently across environments.
- TypeScript JSX configuration may conflict with existing React JSX settings.

### Phase 2: Introduce Input Event Adapter

Goal: remove direct dependence on Ink `useInput` semantics.

Tasks:

- Define a renderer-independent key event shape for MAGI UI actions.
- Map OpenTUI `useKeyboard` events into that shape.
- Keep existing key behavior as close as possible:
  - `ctrl+c` exits.
  - `escape` interrupts or cancels overlays.
  - `tab` accepts slash command suggestion.
  - Arrow keys navigate suggestions, history, questions, selectors, and cursor position.
  - `pageUp` and `pageDown` scroll transcript.
  - `home` and `end` jump transcript scroll.
  - `j` and `k` select transcript messages when prompt is empty.
  - `space` and `enter` expand selected transcript messages when prompt is empty.
  - `backspace` and `delete` edit prompt/question text.
  - printable input inserts text.
- Add paste handling through OpenTUI `usePaste` once the baseline keyboard path works.

Acceptance checks:

- Existing prompt editing behavior is preserved.
- Existing overlay behavior is preserved.
- Prompt submission still reaches the same command and agent execution paths.

Risks:

- OpenTUI key names may not exactly match Ink key names.
- Overlay-specific input priority can regress if the event adapter is too generic.

### Phase 3: Port The Existing View To OpenTUI React

Goal: preserve the current layout and behavior while changing renderer primitives.

Initial mapping:

- Ink `Box` to OpenTUI `<box>`.
- Ink `Text` to OpenTUI `<text>`.
- Transcript container to `<scrollbox>` after the basic port works.
- Composer to `<input>` or `<textarea>` after the manual prompt renderer works.
- Selector overlays to `<select>` after the existing selector flow works.

Tasks:

- Convert `AppView` to OpenTUI JSX.
- Convert `TranscriptView` to OpenTUI JSX while initially preserving the existing line formatter.
- Convert `OverlayArea` to OpenTUI JSX.
- Convert `CommandSuggestions` to OpenTUI JSX.
- Convert `Composer` to OpenTUI JSX.

Acceptance checks:

- Startup dashboard renders.
- Status line renders active agent, model, mode, session, risk, todos, plan path, and run visualization.
- User messages render correctly.
- Assistant text renders correctly.
- Reasoning parts render collapsed and expanded.
- Tool cards render pending, running, completed, error, denied, and skipped states.
- Permission overlay renders and can resolve allow/deny.
- Question overlay renders and can submit option/custom answers.
- Selector overlay renders and can select/cancel.
- Slash command suggestions render and can be accepted.

Risks:

- OpenTUI styling props differ from Ink props.
- Nested rich text support differs from Ink.
- Manual line slicing may fight with OpenTUI's own scroll containers until Phase 4.

### Phase 4: Replace Manual Transcript Slicing With Scrollbox

Goal: use OpenTUI's native scrolling instead of `transcriptLineLimit` and manual visible-line slicing.

Tasks:

- Move transcript content into a focused `<scrollbox>`.
- Preserve selected message and expanded message state.
- Decide whether PageUp/PageDown should control the scrollbox directly or remain controller-managed.
- Preserve auto-follow behavior when the user is at the latest message.
- Preserve non-auto-follow behavior when the user has scrolled up.

Acceptance checks:

- Long transcripts remain responsive.
- Tool detail expansion does not break scroll position.
- New tool events auto-scroll only when the user is already at the bottom.
- Selected transcript item remains visible when navigating with `j` and `k`.

Risks:

- Scroll position ownership may be split between OpenTUI internals and MAGI state.
- Transcript selection and scroll visibility logic may need simplification.

### Phase 5: Replace Manual Composer With Native Input/Textarea

Goal: stop maintaining low-level prompt text editing when OpenTUI can own it.

Tasks:

- Evaluate `<input>` for single-line prompt behavior.
- Evaluate `<textarea>` for multi-line prompt behavior.
- Preserve prompt history behavior.
- Preserve slash command suggestion behavior.
- Preserve queueing behavior when busy.
- Add paste support for multiline prompts.

Acceptance checks:

- Normal prompt submission works.
- Slash commands work.
- Cursor movement and editing work.
- Prompt history works.
- Large pasted prompts work.

Risks:

- Native input components may own cursor state differently than the current controller.
- Slash completion and history navigation may need component-level focus control.

### Phase 6: Replace Selector And Question Overlays With Native Controls

Goal: make overlays less custom and more maintainable.

Tasks:

- Use `<select>` for model, agent, session, and other selectors.
- Keep custom question overlay where multi-question and custom-answer behavior exceeds basic select behavior.
- Optionally use `<input>` for custom question answers.

Acceptance checks:

- `/model` selection works.
- `/agent` selection works.
- `/sessions` selection works.
- Tool-driven `question` prompts still support:
  - single select
  - multi-select
  - custom answer
  - escape cancel

Risks:

- Built-in select may not cover multi-select question semantics.
- Focus transitions between transcript, composer, and overlay must remain deterministic.

### Phase 7: Add OpenTUI-Native Rich Views

Goal: use OpenTUI capabilities that Ink did not provide cleanly.

Candidate improvements:

- Render proposed patches and apply-patch output with `<diff>`.
- Render file snippets, grep results, and LSP output with `<code>` or `<line-number>`.
- Add resize-aware layout through `useTerminalDimensions`.
- Add mouse text selection through `useSelectionHandler`.
- Add a richer split layout for transcript, active run, todos, and tool details once the baseline is stable.

Acceptance checks:

- Rich views are additive and do not block basic terminal workflows.
- Large diffs and code blocks remain responsive.
- Plain-text fallback remains available for terminals where rich rendering fails.

Risks:

- Rich views can distract from the bootstrap goal if introduced too early.
- Syntax highlighting and diff rendering can add performance and dependency complexity.

### Phase 8: Remove Ink

Goal: finish the migration after OpenTUI is the stable default.

Tasks:

- Remove `ink` from `apps/tui/package.json`.
- Remove all `ink` imports.
- Delete old fallback entrypoints if no longer needed.
- Update README workspace layout from Ink-based to OpenTUI-based.
- Update architecture notes that currently say the Ink TUI is the bootstrap shell.
- Update roadmap wording around deferred OpenTUI migration.

Acceptance checks:

- `pnpm --filter @magi/tui typecheck` passes.
- `pnpm --filter @magi/tui build` passes.
- `pnpm --filter @magi/tui test` passes.
- `pnpm lint` passes.
- `pnpm knip` does not report stale Ink dependencies or dead entrypoints.

Risks:

- Documentation may still refer to Ink.
- Some tests or scripts may assume the old entrypoint behavior.

## Behavior That Must Not Regress

The migration must preserve the following user-visible behavior:

- Draft sessions are not persisted until the first successful normal prompt.
- Existing sessions can be resumed.
- `/help` lists commands.
- `/mode` reports active state.
- `/model` lists and switches model providers.
- `/auth` flows still work.
- `/agent`, `/plan`, and `/build` switch agent modes correctly.
- `/queue` and `/clear_queue` work while prompts are queued.
- `/verify` runs configured or explicit verification commands.
- `/revise` works from recent verification failures.
- `/summary` reports changed files, verification results, and residual risks.
- Tool permission prompts block execution until answered.
- Denied tools record denied settlements and return denial observations.
- `question` tool prompts are interactive and return model-readable answers.
- Foreground tasks block as expected.
- Background tasks record task updates without interactive approval.
- Transcript can show system, user, assistant, reasoning, status, and tool parts.
- Tool cards show useful summaries and expandable detail.
- Busy state, active status, active tool, and run visualization update during agent turns.
- `escape` can request interruption during a run.

## Internal Boundaries To Extract

The following modules should be extracted from `app-controller.tsx` over time. These extractions are useful whether or not the renderer is OpenTUI.

### Prompt State

Owns:

- Prompt text.
- Cursor position.
- Prompt history.
- Insert/delete operations.
- Word deletion.
- History navigation.

Candidate file:

- `apps/tui/src/prompt-state.ts`

### Slash Command Runtime

Owns:

- Command parsing.
- Command metadata.
- Suggestion filtering.
- Dispatch to command handlers.

Candidate files:

- `apps/tui/src/slash-commands.ts`
- `apps/tui/src/slash-command-runtime.ts`

### Transcript State

Owns:

- Message append/upsert/update helpers.
- Selection state.
- Expansion state.
- Scroll follow state.
- Message line formatting.

Candidate files:

- `apps/tui/src/transcript-state.ts`
- `apps/tui/src/transcript-format.ts`

### Overlay State

Owns:

- Pending permission prompts.
- Pending question prompts.
- Pending selectors.
- Overlay input priority.
- Resolution and cancellation semantics.

Candidate file:

- `apps/tui/src/overlay-state.ts`

### Agent Runtime Bridge

Owns:

- Building model adapters.
- Building session and system context.
- Running `runAgentTurn`.
- Translating executable actions into tool calls.
- Running tools through permission checks.
- Recording tool settlements.

Candidate file:

- `apps/tui/src/agent-runtime.ts`

This file may still depend on React state setters at first, but it should move toward explicit callbacks such as `appendMessage`, `updateToolPart`, `setActiveStatus`, and `requestPermission`.

## OpenTUI Entrypoint Sketch

The target entrypoint should be close to:

```ts
#!/usr/bin/env node
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { App } from "./app.js";

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
});

createRoot(renderer).render(<App />);
```

The app should handle `ctrl+c` explicitly so MAGI can close stores, stop work, and exit cleanly.

## OpenTUI Keyboard Adapter Sketch

The renderer adapter should translate OpenTUI events into MAGI-level input events.

```ts
export type TuiKeyEvent = {
  name: string;
  input: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
};
```

The controller should not depend on OpenTUI-specific event objects. It should receive normalized events such as:

- `return`
- `escape`
- `tab`
- `backspace`
- `delete`
- `up`
- `down`
- `left`
- `right`
- `pageUp`
- `pageDown`
- `home`
- `end`
- printable input text

## Verification Checklist

Run these checks during the migration:

```sh
pnpm --filter @magi/tui typecheck
pnpm --filter @magi/tui build
pnpm --filter @magi/tui test
pnpm lint
pnpm knip
```

Manual smoke test checklist:

- Start the app with `pnpm --filter @magi/tui start`.
- Submit a simple prompt.
- Submit a prompt while busy and verify it queues.
- Open `/help`.
- Open `/model` and cancel.
- Open `/agent` and cancel.
- Open `/sessions` and cancel.
- Trigger a read-only tool call.
- Trigger a permission-gated tool call and deny it.
- Trigger a permission-gated tool call and allow it.
- Trigger a `question` tool prompt.
- Scroll transcript.
- Select and expand a tool card.
- Press `escape` during a run and verify interruption is requested.
- Exit cleanly with `ctrl+c`.

## Initial Implementation Order

The safest near-term order is:

1. Add OpenTUI dependencies.
2. Add an OpenTUI boot path that renders a minimal screen.
3. Add keyboard adapter and verify exit/input behavior.
4. Port `Composer`, `CommandSuggestions`, and `OverlayArea`.
5. Port `TranscriptView` using the existing line formatter.
6. Wire the current controller into the OpenTUI view.
7. Replace manual transcript slicing with `<scrollbox>`.
8. Replace manual composer editing with `<input>` or `<textarea>` if it does not regress behavior.
9. Add OpenTUI-native diff/code views.
10. Remove Ink and update docs.

## Non-Goals For The First Pass

Do not combine the OpenTUI migration with these changes:

- Rewriting the agent runner.
- Changing session schema.
- Changing tool permission semantics.
- Changing MAGI consensus behavior.
- Redesigning every screen visually.
- Adding daemon mode.
- Adding plugin/custom tool registry behavior.
- Adding sandbox execution.

These are separate product tracks. The OpenTUI migration should make them easier later by reducing TUI complexity, not block on them.

## Decision

Proceed with OpenTUI, but do it in controlled slices. The migration should preserve behavior first, then use OpenTUI-specific capabilities to simplify and improve the interface.
