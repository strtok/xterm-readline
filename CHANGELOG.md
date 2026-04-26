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
