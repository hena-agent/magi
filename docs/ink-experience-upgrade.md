# Ink Experience Upgrade Plan

## Status

This is the active TUI plan.

MAGI will keep Ink as the primary renderer and build an OpenCode/OpenTUI-style experience on top of the existing Node + React + Ink stack. The previous OpenTUI native migration is blocked by OpenTUI's Node FFI runtime support and is now reference material only.

## Decision

Use Ink as the production renderer for the next phase.

Reasons:

- Ink already runs in MAGI's Node 22 + pnpm runtime.
- Ink is React-based and fits the current component/controller structure.
- Ink works with the existing `better-sqlite3` session store.
- Agentic CLIs such as Claude Code and Gemini CLI use Ink-style React terminal rendering successfully.
- OpenTUI native rendering cannot currently initialize under Node in this environment because OpenTUI core cannot open its native FFI backend.

OpenTUI remains useful as a design and API reference, but not as the active renderer target until its Node runtime path works without Bun or unsupported Node FFI flags.

## Goals

- Preserve the existing daily-driver command: `pnpm --filter @magi/tui start`.
- Make the Ink TUI feel closer to a focused coding-agent interface:
  - responsive full-height layout
  - compact landing state
  - transcript viewport
  - sticky composer
  - attached slash suggestions
  - consistent overlays
  - stable paste and cursor behavior
- Continue extracting renderer-neutral state and action helpers so future renderer experiments remain possible.
- Avoid a big-bang rewrite.

## Non-Goals

- Do not remove OpenTUI prototype files yet.
- Do not make Bun a project runtime.
- Do not switch to terminal-kit or another imperative renderer without a separate spike and decision.
- Do not block Ink UX improvements on OpenTUI native support.

## Current Assets To Reuse

Renderer-neutral helpers already extracted:

- `apps/tui/src/prompt-state.ts`
- `apps/tui/src/slash-commands.ts`
- `apps/tui/src/tui-key-event.ts`
- `apps/tui/src/transcript-format.ts`
- `apps/tui/src/transcript-state.ts`
- `apps/tui/src/transcript-parts.ts`
- `apps/tui/src/tui-session-state.ts`

OpenTUI prototype files to keep as reference:

- `apps/tui/src/opentui-composer.tsx`
- `apps/tui/src/opentui-command-suggestions.tsx`
- `apps/tui/src/opentui-transcript.tsx`
- `apps/tui/src/opentui-index.tsx`
- `apps/tui/src/opentui-info.ts`
- `apps/tui/src/opentui-node-loader.ts`
- `apps/tui/src/opentui-session-boot.ts`

These files should not drive product architecture. Use them only for implementation ideas such as compact layout, cursor rendering, suggestion behavior, and transcript line reuse.

## Target Ink Experience

### Default Mode

Keep the current main-screen behavior stable until fullscreen is proven.

The default command remains:

```sh
pnpm --filter @magi/tui start
```

### Fullscreen Mode

Add fullscreen as an opt-in mode first.

Candidate activation:

```sh
MAGI_TUI_FULLSCREEN=1 pnpm --filter @magi/tui start
```

Fullscreen mode should use alternate screen, hide the terminal cursor while the app owns rendering, restore terminal state on exit, and gracefully fall back if stdin/stdout is not interactive.

### Responsive Layout

The layout should adapt to terminal size.

Wide terminals:

```txt
┌ status: agent/model/mode/session/risk/todos ┐
│ transcript viewport                          │
│ selected/expanded tool and reasoning details  │
├ attached slash suggestions / overlays         │
│ > composer with visible cursor                │
└ footer: shortcuts/status/queue                ┘
```

Narrow terminals:

```txt
status
transcript viewport
overlay or suggestions
> composer
footer
```

## Phased Plan

### Phase 1: Document And Freeze Direction

Status: active.

Tasks:

- Add this document.
- Mark OpenTUI migration docs as blocked/reference.
- Update README to make Ink primary and OpenTUI experimental.

Done when:

- Future work points here for TUI UX direction.
- OpenTUI docs no longer imply active renderer replacement.

### Phase 2: Ink Fullscreen Shell

Goal: provide an opt-in full-height shell without changing default behavior.

Tasks:

- Add fullscreen config/env gate.
- Add alternate screen enter/exit helper for Ink runtime.
- Track terminal size and resize events.
- Pass layout mode and terminal dimensions into `AppView`.
- Keep default main-screen layout unchanged.

Acceptance checks:

- Default `pnpm --filter @magi/tui start` behaves as before.
- `MAGI_TUI_FULLSCREEN=1 pnpm --filter @magi/tui start` restores terminal state on exit.
- Non-interactive execution does not attempt alternate screen control.

### Phase 3: Transcript Viewport

Goal: make transcript rendering feel like a stable viewport instead of a growing block.

Tasks:

- Use terminal height to compute transcript line limit in fullscreen mode.
- Reuse `getTranscriptVisibleLineWindow()` for all visible line slicing.
- Keep selection visible while navigating with `j`/`k`.
- Preserve expanded reasoning/tool details.
- Add compact older/newer hidden indicators.

Acceptance checks:

- Long transcripts stay responsive.
- PageUp/PageDown/Home/End continue to work.
- Selection and expansion are visually clear.

### Phase 4: Composer And Suggestions

Goal: make prompt entry feel compact and predictable.

Tasks:

- Port the useful OpenTUI prototype behavior back to Ink:
  - visible block cursor
  - multiline paste preservation
  - exact slash command hides suggestions
  - Enter completes suggestions before submit
  - suggestions attach directly above/below the composer
- Keep prompt state in `prompt-state.ts`.
- Keep slash suggestions in `slash-commands.ts`.

Acceptance checks:

- Pasted newlines survive.
- `cmd+v`/bracketed paste behavior is stable where supported by Ink.
- Slash suggestion behavior matches tests.

### Phase 5: Overlay Consolidation

Goal: make permission, question, selector, model, agent, and session overlays visually consistent.

Tasks:

- Refactor `overlays.tsx` into smaller components.
- Use one compact panel language for permission/question/selector.
- Ensure overlay input priority remains deterministic.
- Keep keyboard shortcuts documented in the footer.

Acceptance checks:

- Permission approvals still resolve tools correctly.
- Question multi-select and free text still work.
- Selector flows for model/agent/session still work.

### Phase 6: Controller Extraction

Goal: reduce risk in `app-controller.tsx` while keeping Ink as the active renderer.

Tasks:

- Extract `sessionEventsToTranscriptMessages()` into a renderer-neutral module.
- Extract command dispatch from `handleCommand()`.
- Extract transcript navigation actions.
- Extract permission/question/selector input handlers.

Acceptance checks:

- Existing tests pass.
- New focused tests cover extracted behavior.
- App behavior remains unchanged in default mode.

## OpenTUI Policy

OpenTUI files stay in the repo for reference and future reevaluation.

Current commands:

```sh
pnpm --filter @magi/tui start:opentui
pnpm --filter @magi/tui start:opentui:native
```

`start:opentui` prints migration status. `start:opentui:native` attempts native rendering but exits gracefully with a diagnostic if OpenTUI core native FFI is unavailable.

Do not add new product features only to the OpenTUI path until native rendering works under Node.

## Alternative Renderer Policy

Terminal-kit is the only alternative worth a small spike if Ink cannot meet a concrete requirement. Blessed, neo-blessed, and react-blessed are not good primary candidates due to age, maintenance status, or React version mismatch.

Before adopting any alternative renderer, require a short spike proving:

- Node-only runtime.
- No Bun requirement.
- No unsupported native FFI requirement.
- Responsive transcript viewport.
- Prompt input with paste/newline behavior.
- Clean terminal restore on exit.

## Immediate Next Steps

1. Implement opt-in Ink fullscreen shell.
2. Make transcript viewport height responsive in fullscreen mode.
3. Improve Ink composer and slash suggestions using behavior already proven in shared helpers.
4. Continue controller extraction, starting with session event transcript conversion.
