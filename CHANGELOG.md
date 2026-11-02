## [2.0.0] - 2026-11-02
### Added
- `read(prompt, { signal })`: aborting the `AbortSignal` rejects the pending
  read with `signal.reason`. An already-aborted signal rejects without
  printing a prompt. Abandoned input stays on screen and the cursor is left
  after it; no `^C` or new prompt is printed (#12, #18).
- During a read with a signal, Ctrl-C also calls the `setCtrlCHandler()`
  handler, which can abort the read. Reads without a signal behave as before.

### Changed
- **Breaking:** calling `read()` while another read is pending now rejects
  with "a read is already active" instead of replacing the pending read.

### Fixed
- `dispose()` releases a pending read, so an addon loaded again can read again.
  The released promise stays pending unless its signal is aborted.
- Prompt output still in flight after a cancel, re-activation, or a newer
  prompt can no longer reset input or resume a finished read.

## [1.3.1] - 2026-10-04
### Fixed
- Prompts containing characters whose width xterm measures differently
  (e.g. emoji such as `🚀`) no longer leave a gap before the input or
  shift it left after Backspace. The prompt is now rendered by xterm and
  the input is anchored at the measured cursor position; the prompt is
  reprinted and remeasured on resize, Ctrl-L, Ctrl-C, and when returning
  from a clipped input window. Keys typed while the prompt is being
  measured are queued (#17).

## [1.3.0] - 2026-10-01
### Added
- `read()` preserves output already written on the row where the prompt
  starts, instead of erasing it. The prompt is anchored at the cursor's
  column (`Tty.anchorCol`) and wraps at the remaining width of that row;
  later rows still start at column 0 (#16).

## [1.2.2] - 2026-04-26
### Fixed
- Phantom cursor flash on the line above when refreshing a multi-line
  buffer. `Tty.refreshLine` now wraps its emit in cursor hide/show
  (`\x1b[?25l` / `\x1b[?25h`) so the intermediate cursor-up / row-rewrite
  / cursor-down sequence isn't visible.
- Vertical cursor movement (Up/Down) between buffer line 0 and line 1
  ignored the prompt prefix on line 0, so the cursor jumped by
  `promptSize.col` columns when crossing that boundary. `LineBuffer.moveLineUp`
  and `moveLineDown` now take a `promptCols` argument and adjust on
  line-0 transitions.

## [1.2.1] - 2026-04-26
### Fixed
- Highlighted brackets (or any cursor-driven SGR) no longer stay frozen
  in scrollback after pressing Enter. The line is re-rendered through
  an `IdentityHighlighter` once at commit time. New `State.refreshUnhighlighted()` helper.

## [1.2.0] - 2026-04-25
### Added
- Multi-line viewport rendering with bash-style edit/history behavior.
- Methods to read and update the current line buffer (#13).

### Changed
- Bump GitHub Actions versions.

## [1.1.3] - 2026-04-25
### Changed
- Widen `@xterm/xterm` peer dependency to `^5.5.0 || ^6.0.0`
- Bump dev dependencies (typescript-eslint, prettier, nodemon, ts-jest, typescript)

## [1.1.0] - 2022-12-25
### Changed
- Support xterm.js 5.0.0

## [1.1.0] - 2022-10-18
### Changed
- Added support for ctrl-k [#4]

## [1.0.7] - 2022-04-10
### Changed
- Fixed a bug where a lookbehind regex was used, which breaks on browsers that lack support for lookbehind (e.g. Safari).


## [1.0.6] - 2022-04-10
### Changed
- Fixed a bug where multiline input starting with \n broke on refresh [#2]
