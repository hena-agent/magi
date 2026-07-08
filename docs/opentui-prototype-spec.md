# OpenTUI Prototype Spec

## Current Status: Reference Only

This spec is no longer active. OpenTUI native rendering is blocked by Node FFI support in the current environment. The active TUI plan is `docs/ink-experience-upgrade.md`, which keeps Ink as the production renderer and uses OpenTUI prototype work only as design/behavior reference.

## Purpose

This document defines the next concrete OpenTUI prototype target. It is intentionally smaller than full TUI parity. The goal is to make `pnpm --filter @magi/tui start:opentui` feel like a usable compact landing shell instead of a renderer smoke test.

## Current Problem

The native OpenTUI path now renders, but a full-screen bordered smoke-test panel is visually noisy for an empty session. The empty state should be closer to OpenCode's concise landing screen.

The next prototype must:

- Preserve the terminal's default background.
- Show a stable compact landing layout for an empty session.
- Keep the existing Ink TUI unchanged.
- Continue using shared input and prompt-state helpers.

## Target Layout

Status: implemented in `apps/tui/src/opentui-index.tsx` as the current native OpenTUI compact landing shell.

The empty OpenTUI prototype should render:

```txt
                              magi

                  Build - GPT-5.5 OpenAI
                  tab agents ctrl+p commands

                  > Ask anything... "Fix a TODO in the codebase" [ ]
                  q/ctrl+c exit tab complete enter submit
```

## Scope

In scope:

- Compact centered landing layout using the terminal's default background.
- Minimal model/mode/status line.
- OpenTUI Composer component.
- OpenTUI CommandSuggestions component.
- Last submitted prompt display after the first submission.
- Prompt editing and slash suggestions using shared helpers.
- High-contrast foreground and border colors without forcing a terminal background color.

## Implementation Notes

- The prototype reads `process.stdout.columns` and `process.stdout.rows`, with `80x24` fallback.
- The root OpenTUI box receives explicit `width` and `height` and updates them through `useOnResize` so the app follows terminal size changes.
- The prototype preserves the terminal's default background and derives the normal foreground from the terminal palette when available.
- If palette detection fails, `MAGI_OPENTUI_TEXT_COLOR` can override the normal foreground color for local terminal themes.
- Empty sessions do not show the smoke-test transcript placeholder. Real session events are not connected yet.

Out of scope:

- Connecting to the real agent runner.
- Session persistence in the OpenTUI path.
- Real transcript rendering.
- Permission/question overlays.
- Scrollbox migration.
- Removing Ink.

## Interaction Spec

The OpenTUI prototype must support:

- `q`: exit when not using it as prompt text. Current smoke path exits on `q` for fast testing.
- `ctrl+c`: exit.
- Printable characters: insert into prompt.
- `left` / `right`: move cursor.
- `ctrl+a` / `ctrl+e`: jump cursor start/end.
- `ctrl+u`: clear prompt.
- `ctrl+w`: delete previous word.
- `backspace` / `delete`: delete previous character.
- `enter`: complete the selected command when suggestions are visible; otherwise submit prompt to `last submitted` and clear prompt.
- `/`: show compact command suggestions.
- `up` / `down`: move command suggestion selection.
- `tab`: complete selected command.
- Exact command inputs such as `/plan` hide command suggestions.

## Acceptance Checks

Automated checks:

```sh
pnpm --filter @magi/tui test
pnpm --filter @magi/tui typecheck
pnpm --filter @magi/tui build
pnpm format:check
MAGI_OPENTUI_SMOKE=1 pnpm --filter @magi/tui start:opentui:native
```

Manual checks:

- `pnpm --filter @magi/tui start:opentui:native` renders a compact centered landing screen once the Node/OpenTUI runtime path works.
- Resizing the terminal updates the layout width and height.
- Typing updates the composer.
- `enter` updates `last submitted` unless command suggestions are visible.
- Typing `/` shows command suggestions.
- `tab` or `enter` completes a selected command while suggestions are visible.
- `q` or `ctrl+c` exits.

## Next Step After This Spec

Once this prototype shell is stable, port `OverlayArea` or begin extracting transcript formatting into `transcript-format.ts` before attempting the real transcript view.
