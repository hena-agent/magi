# OpenTUI Migration Plan

## Current Status: Blocked Reference

This is no longer the active TUI migration plan.

The active plan is `docs/ink-experience-upgrade.md`: keep Ink as MAGI's production renderer and build the OpenCode/OpenTUI-like experience on top of the existing Node + React + Ink stack.

OpenTUI remains in the repository as experimental/reference code only. The native renderer path is blocked because `@opentui/core@0.4.3` cannot initialize its native FFI backend under the current Node runtime. The ESM import issue is shimmed by `apps/tui/src/opentui-node-loader.ts`, but the native renderer still cannot become the production path until OpenTUI supports Node without Bun or unsupported FFI flags.

Do not use this document as the implementation plan for new TUI work. Use it as historical context for the OpenTUI exploration.

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

### Progress Tracker

| Area | Status | Current artifact | Next move |
| --- | --- | --- | --- |
| OpenTUI baseline | Done | `apps/tui/src/opentui-info.ts`, `apps/tui/src/opentui-index.tsx` | Keep native renderer behind `MAGI_OPENTUI_NATIVE=1` until Node runtime path works |
| Input adapter | In progress | `tui-key-event.ts`, `prompt-state.ts`, OpenTUI `usePaste` | Move more controller actions behind renderer-neutral handlers |
| Composer | Prototype done | `opentui-composer.tsx` | Evaluate native `<input>` / `<textarea>` later |
| Slash suggestions | Prototype done | `slash-commands.ts`, `opentui-command-suggestions.tsx` | Extract command dispatch from `app-controller.tsx` |
| Transcript formatting | Done | `transcript-format.ts` | Wire real session messages from the controller |
| Transcript state | Done | `transcript-state.ts` | Extract more controller actions behind renderer-neutral handlers |
| Transcript parts | Done | `transcript-parts.ts` | Use shared helpers when extracting session event transcript conversion |
| OpenTUI transcript view | Prototype done | `opentui-transcript.tsx` | Replace submitted-prompt smoke messages with real session messages |
| Session initialization | In progress | `tui-session-state.ts`, `opentui-session-boot.ts` | Move full session event to transcript conversion out of `app-controller.tsx` |
| Overlays | Not started | Ink `overlays.tsx` | Port permission/question/selector after transcript path exists |
| Agent loop wiring | Not started | Ink `app-controller.tsx` | Extract controller hook/service, then connect OpenTUI entrypoint |
| Scrollbox | Not started | manual slicing in Ink view | Replace after shared transcript rendering is stable |

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

Status: implemented as an experimental Bun-backed entrypoint.

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

Current implementation notes:

- `apps/tui/src/opentui-index.tsx` contains the minimal OpenTUI boot screen.
- `pnpm --filter @magi/tui start:opentui` builds the package and prints a stable Node-based migration baseline.
- `pnpm --filter @magi/tui start:opentui:info` is an explicit alias for the Node-based migration baseline.
- `pnpm --filter @magi/tui start:opentui:native` attempts the native renderer with Node and `MAGI_OPENTUI_NATIVE=1`.
- `pnpm --filter @magi/tui start:opentui:tsx` currently aliases the built native renderer path; source-mode OpenTUI execution is deferred until the Node native runtime path is reliable.
- Set `MAGI_OPENTUI_SMOKE=1` to make the OpenTUI boot path render once and exit automatically for smoke verification.
- The experimental OpenTUI path defaults to `main-screen` with terminal size fallbacks so rendering failures are easier to see while debugging. Set `MAGI_OPENTUI_ALTERNATE_SCREEN=1` to test alternate-screen behavior.
- Keep `pnpm --filter @magi/tui start` on the existing Ink path until the OpenTUI path reaches feature parity.

Runtime finding:

- OpenTUI 0.4.3 imports `react-reconciler/constants` without the `.js` extension, which Node ESM does not resolve. `apps/tui/src/opentui-node-loader.ts` is a narrow Node ESM loader shim that maps only that specifier to `react-reconciler/constants.js` for native OpenTUI experiments.
- With the ESM shim in place, native startup advances to OpenTUI core FFI initialization. Node 22.20.0 in this environment does not provide the required native FFI backend (`--experimental-ffi` / `--allow-ffi` are not supported), so native rendering still cannot complete under Node yet. `opentui-index.tsx` catches that renderer initialization failure and exits gracefully with a diagnostic message instead of crashing.
- Do not use Bun as a project runtime. Previous Bun smoke scripts were removed because MAGI is a Node/pnpm project and Bun cannot load the existing `better-sqlite3` session store backend.
- Future migration work should keep the native OpenTUI renderer behind `MAGI_OPENTUI_NATIVE=1` until OpenTUI adds a working Node runtime path without the loader shim or MAGI adopts a Node-compatible bundling step.

Risks:

- OpenTUI native package loading may behave differently across environments.
- TypeScript JSX configuration may conflict with existing React JSX settings.

### Phase 2: Introduce Input Event Adapter

Status: in progress. Both the OpenTUI boot path and the current Ink controller now use renderer-independent key event normalization.

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

Current implementation notes:

- `apps/tui/src/tui-key-event.ts` defines `TuiKeyEvent`, `normalizeOpenTuiKeyEvent`, and `isExitKey`.
- `apps/tui/src/tui-key-event.ts` also defines `normalizeInkInputEvent` so the existing Ink controller can move toward the same input path before the renderer is replaced.
- `apps/tui/src/tui-key-event.test.ts` covers named key normalization, printable input separation, Ink key mapping, and exit key matching.
- `apps/tui/src/opentui-index.tsx` now exits through the normalized key event path instead of reading OpenTUI key objects directly.
- `apps/tui/src/app-controller.tsx` still uses Ink `useInput`, but it now normalizes each input through `normalizeInkInputEvent` before dispatching prompt, overlay, selector, transcript, and command shortcuts.

Acceptance checks:

- Existing prompt editing behavior is preserved.
- Existing overlay behavior is preserved.
- Prompt submission still reaches the same command and agent execution paths.

Risks:

- OpenTUI key names may not exactly match Ink key names.
- Overlay-specific input priority can regress if the event adapter is too generic.

### Phase 3: Port The Existing View To OpenTUI React

Status: started for the Composer and command suggestion paths. Minimal OpenTUI prompt editing and slash suggestion smoke paths exist in the experimental boot screen.

Goal: preserve the current layout and behavior while changing renderer primitives.

Initial mapping:

- Ink `Box` to OpenTUI `<box>`.
- Ink `Text` to OpenTUI `<text>`.
- Transcript container to `<scrollbox>` after the basic port works.
- Composer to `<input>` or `<textarea>` after the manual prompt renderer works.
- Selector overlays to `<select>` after the existing selector flow works.

Tasks:

- Convert `AppView` to OpenTUI JSX.
- Convert `TranscriptView` to OpenTUI JSX while preserving the shared line formatter.
- Convert `OverlayArea` to OpenTUI JSX.
- Convert `CommandSuggestions` to OpenTUI JSX.
- Convert `Composer` to OpenTUI JSX.

Current implementation notes:

- `apps/tui/src/opentui-index.tsx` now renders a minimal prompt editing area using `TuiKeyEvent` and `prompt-state.ts`.
- `apps/tui/src/opentui-composer.tsx` contains the first OpenTUI-specific component port. It mirrors the current Composer responsibility by rendering prompt text and cursor state without owning input handling.
- `apps/tui/src/opentui-composer.test.ts` covers prompt cursor preview formatting.
- `apps/tui/src/opentui-command-suggestions.tsx` mirrors the current command suggestion rendering responsibility for OpenTUI.
- `apps/tui/src/opentui-command-suggestions.test.ts` covers command suggestion line formatting.
- `apps/tui/src/transcript-format.ts` now owns renderer-neutral transcript line formatting used by the Ink `TranscriptView` and ready for OpenTUI reuse.
- `apps/tui/src/transcript-format.test.ts` covers user, assistant, reasoning, and tool line formatting.
- `apps/tui/src/transcript-state.ts` now owns renderer-neutral transcript line windows, scroll clamping, selectable IDs, expandability checks, and keep-visible offset calculations.
- `apps/tui/src/transcript-state.test.ts` covers transcript counts, visible windows, ranges, selection IDs, scroll clamping, and keep-visible behavior.
- `apps/tui/src/transcript-parts.ts` now owns renderer-neutral transcript part merging, tool input lookup, matching tool part IDs, and stable tool input comparisons used by the Ink controller and future session event transcript extraction.
- `apps/tui/src/transcript-parts.test.ts` covers tool/reasoning merge semantics, upsert behavior, tool input lookup, matching IDs, and stable comparisons.
- `apps/tui/src/opentui-transcript.tsx` renders shared transcript lines in the OpenTUI prototype.
- `apps/tui/src/opentui-index.tsx` now uses the shared transcript state helpers for smoke transcript page scrolling, selection with `j`/`k`, and expansion with `space`/`enter` when the prompt is empty.
- `apps/tui/src/opentui-transcript-format.ts` contains OpenTUI-specific transcript color mapping and submitted-prompt smoke message helpers.
- `apps/tui/src/tui-session-state.ts` now owns initial session resume selection, initial model provider selection, system transcript message creation, and the shared session-start transcript message used by both Ink and OpenTUI paths.
- `apps/tui/src/opentui-session-boot.ts` owns testable OpenTUI session-store bootstrapping and fallback behavior with dependency injection for runtime-specific store failures.
- `apps/tui/src/opentui-index.tsx` now loads the real MAGI config and attempts to open the session store so the OpenTUI prototype can start from the same draft/resume session state as the Ink controller when the runtime supports the store backend.
- The native OpenTUI path treats session store initialization as best-effort so renderer experiments do not crash before drawing if a runtime-specific store backend issue appears.
- The OpenTUI prompt smoke path supports cursor movement, character insertion, character deletion, word deletion, line clearing, submit display, and smoke-mode auto-exit.
- The OpenTUI slash suggestion smoke path supports showing sample commands, up/down selection, and tab completion without connecting to the real slash command runtime yet.
- This is not connected to the agent runner yet. It exists to verify the shared input and prompt-state path before porting the real `Composer` and controller view.

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

Status: extracted for the existing prompt editing and history helpers.

Owns:

- Prompt text.
- Cursor position.
- Prompt history.
- Insert/delete operations.
- Word deletion.
- History navigation.

Candidate file:

- `apps/tui/src/prompt-state.ts`

Current implementation notes:

- `apps/tui/src/prompt-state.ts` owns pure prompt text, cursor, deletion, insertion, and history selection helpers.
- `apps/tui/src/prompt-state.test.ts` covers cursor clamping, character insertion/deletion, word deletion, history deduplication, and history navigation.
- `apps/tui/src/app-controller.tsx` still owns React state, but its prompt editing functions now delegate to `prompt-state.ts`.

### Slash Command Runtime

Status: metadata, suggestion filtering, and help formatting extracted. Command execution still lives in `app-controller.tsx`.

Owns:

- Command parsing.
- Command metadata.
- Suggestion filtering.
- Dispatch to command handlers.

Candidate files:

- `apps/tui/src/slash-commands.ts`
- `apps/tui/src/slash-command-runtime.ts`

Current implementation notes:

- `apps/tui/src/slash-commands.ts` owns `SlashCommandInfo`, `slashCommands`, `visibleSlashCommands`, `getSlashCommandSuggestions`, and `formatSlashCommandHelp`.
- `apps/tui/src/slash-commands.test.ts` covers suggestion filtering and help grouping.
- `apps/tui/src/app-controller.tsx`, the Ink command suggestions view, the OpenTUI command suggestions view, and the OpenTUI boot smoke path now share the same command metadata and suggestion helper.
- Command execution dispatch is still intentionally left in `app-controller.tsx` for now.

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
MAGI_OPENTUI_SMOKE=1 pnpm --filter @magi/tui start:opentui:native
pnpm --filter @magi/tui start:opentui:info
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
