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
