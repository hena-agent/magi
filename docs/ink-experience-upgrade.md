# Ink Experience Upgrade Plan

## Status

This is the active TUI plan. The Ink daily-driver milestone is implemented: interactive terminals use fullscreen by default, while non-interactive output falls back to inline rendering.

MAGI uses Ink as its sole production TUI renderer and builds the coding-agent experience on the existing Node + React + Ink stack.

## Decision

Use Ink as the production renderer for the next phase.

Reasons:

- Ink already runs in MAGI's Node 22 + pnpm runtime.
- Ink is React-based and fits the current component/controller structure.
- Ink works with the existing `better-sqlite3` session store.
- Agentic CLIs such as Claude Code and Gemini CLI use Ink-style React terminal rendering successfully.

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
- Keep renderer-neutral state and action helpers where they reduce product risk.
- Prioritize visible daily-driver behavior over further controller extraction.

## Non-Goals

- Do not make Bun a project runtime.
- Do not switch to terminal-kit or another imperative renderer without a separate spike and decision.

## Renderer-Neutral Assets

Renderer-neutral helpers already extracted:

- `apps/tui/src/prompt-state.ts`
- `apps/tui/src/slash-commands.ts`
- `apps/tui/src/tui-key-event.ts`
- `apps/tui/src/transcript-format.ts`
- `apps/tui/src/transcript-state.ts`
- `apps/tui/src/transcript-parts.ts`
- `apps/tui/src/tui-session-state.ts`

## Target Ink Experience

### Default Mode

Interactive TTY sessions use the alternate-screen fullscreen Ink UI by default. Non-interactive stdin/stdout uses inline rendering without terminal control sequences.

The default command remains:

```sh
pnpm --filter @magi/tui start
```

Fullscreen mode uses alternate screen, hides the native terminal cursor while the app owns rendering, restores terminal state on exit, and gracefully falls back when stdin/stdout is not interactive. Ctrl+C first cancels active foreground work and discards queued prompts; a second Ctrl+C forces exit. SIGINT and SIGTERM cancel foreground and background operations, wait up to five seconds for settlement and persistence, then force process termination if a provider does not cooperate.

### Responsive Layout

The layout should adapt to terminal size.

Wide terminals:

```txt
MAGI  agent · model · session · status
workspace · risk · todos · queue
transcript viewport
selected/expanded tool and reasoning details
attached slash suggestions or overlay
╭ composer with visible cursor ╮
contextual footer
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

Status: complete.

Tasks:

- Add this document.
- Remove superseded renderer experiments and keep Ink as the only supported TUI path.
- Update README to make Ink renderer behavior explicit.

Done when:

- Future work points here for TUI UX direction.
- No alternate renderer path is shipped or documented.

### Phase 2: Ink Fullscreen Shell

Status: complete and promoted to the default interactive mode.

Goal: provide a full-height shell with safe terminal ownership.

Tasks:

- Detect interactive TTY capability.
- Add alternate screen enter/exit helper for Ink runtime.
- Track terminal size and resize events.
- Pass layout mode and terminal dimensions into `AppView`.
- Keep non-interactive inline fallback.

Acceptance checks:

- Default `pnpm --filter @magi/tui start` enters fullscreen in an interactive terminal.
- Fullscreen restores terminal state on exit.
- Non-interactive execution does not attempt alternate screen control.

### Phase 3: Transcript Viewport

Status: complete.

Goal: make transcript rendering feel like a stable viewport instead of a growing block.

Tasks:

- Use Ink flex layout and `measureElement()` to compute the actual transcript line limit.
- Reuse `getTranscriptVisibleLineWindow()` for all visible line slicing.
- Keep selection visible while navigating with `j`/`k`.
- Preserve expanded reasoning/tool details.
- Add compact older/newer hidden indicators.

Acceptance checks:

- Long transcripts stay responsive.
- PageUp/PageDown/Home/End continue to work.
- Selection and expansion are visually clear.

### Phase 4: Composer And Suggestions

Status: complete.

Goal: make prompt entry feel compact and predictable.

Tasks:

- Implement the required coding-agent input behavior in Ink:
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
- Multiline composer content is windowed around the cursor and capped by terminal density.

### Phase 5: Overlay Consolidation

Status: complete.

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

Status: sufficient for the daily-driver milestone. Session event transcript conversion, transcript navigation, and overlay input handlers are extracted. Command dispatch remains in `app-controller.tsx` and is deliberately deferred until a product need justifies it.

Tasks:

- Extract `sessionEventsToTranscriptMessages()` into a renderer-neutral module.
- Extract command dispatch from `handleCommand()`.
- Extract transcript navigation actions.
- Extract permission/question/selector input handlers.

Implemented modules:

- `apps/tui/src/session-event-transcript.ts`
- `apps/tui/src/session-event-format.ts`
- `apps/tui/src/transcript-navigation.ts`
- `apps/tui/src/overlay-input.ts`
- `apps/tui/src/transcript-types.ts`

Acceptance checks:

- Existing tests pass.
- New focused tests cover extracted behavior.
- App behavior remains unchanged in default mode.

### Phase 7: Daily-Driver Visual Shell

Status: complete.

Implemented behavior:

- Borderless transcript with semantic tool/reasoning status colors.
- Two-line responsive MAGI run rail.
- Centered repository landing state with responsive MAGI artwork: a full ASCII wordmark on wide
  terminals and a compact one-line mark on narrow terminals.
- Sticky prompt dock with attached suggestions and overlays.
- Wide, narrow, and short-terminal density policies.
- Render-to-string regression coverage for landing, conversation, suggestions, and permission states.
- PTY smoke coverage for 80x24 and 60x20 layouts, slash suggestions, multiline bracketed paste, and terminal restoration.

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

1. Use the fullscreen Ink UI as the normal development path and collect concrete friction reports.
2. Add focused regression cases when real permission/question/session workflows expose layout issues.
3. Defer command-dispatch extraction until command behavior needs modification.
4. Consider alternative renderer research only if Ink fails a concrete product requirement.
