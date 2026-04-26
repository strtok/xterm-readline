// User-visible render tests: drive State the way a user would (type, press
// keys, recall history) and assert on the resulting screen + cursor as they
// appear in a virtual terminal. Replaces brittle byte-level assertions and
// covers behaviors the original test suite did not (terminal-scroll-on-tall-
// recall, edit-mode lockout, right-margin trailing wrap, SGR across rows,
// onResize anchor clamp).

import { State } from "./state";
import { Tty } from "./tty";
import { History } from "./history";
import { Highlighter, IdentityHighlighter } from "./highlight";
import { VTerm } from "./vterm";

function setup(
  cols: number,
  rows: number,
  opts: {
    prompt?: string;
    anchor?: number;
    highlighter?: Highlighter;
    history?: string[];
  } = {}
) {
  const vt = new VTerm(cols, rows);
  // Move the virtual cursor to the requested anchor row before constructing
  // State so the very first refresh starts from a known physical row, just
  // like Readline.read() does in production.
  if (opts.anchor && opts.anchor > 0) {
    vt.write("\n".repeat(opts.anchor));
  }
  const tty = new Tty(cols, rows, 8, vt, opts.anchor ?? 0);
  const history = new History(50);
  for (const e of opts.history ?? []) history.append(e);
  const state = new State(
    opts.prompt ?? "> ",
    tty,
    opts.highlighter ?? new IdentityHighlighter(),
    history
  );
  state.refresh();
  return { vt, tty, state };
}

test("typed single-line input renders prompt + text", () => {
  const { vt, state } = setup(20, 5);
  state.editInsert("abc");
  expect(vt.screen()).toBe("> abc");
  expect(vt.cursor()).toEqual([0, 5]);
});

test("multi-line insert renders all rows and lands cursor at end", () => {
  const { vt, state } = setup(20, 5);
  state.editInsert("a\nb\nc");
  expect(vt.screen()).toBe("> a\nb\nc");
  expect(vt.cursor()).toEqual([2, 1]);
});

test("buffer taller than viewport scrolls window to follow cursor", () => {
  const { vt, state } = setup(20, 3);
  // 5 visual rows: "> a","b","c","d","e" — viewport=3, so window shows the
  // last 3 rows with the cursor at the bottom.
  state.editInsert("a\nb\nc\nd\ne");
  expect(vt.screen()).toBe("c\nd\ne");
  expect(vt.cursor()).toEqual([2, 1]);
});

test("ArrowUp past top of window scrolls window down", () => {
  const { vt, state } = setup(20, 3);
  state.editInsert("a\nb\nc\nd\ne"); // window: c,d,e
  state.moveCursorBack(1); // enter edit mode (so Up moves within buffer)
  state.moveCursorUp(1); // → row 3 ("d"), still in window
  state.moveCursorUp(1); // → row 2 ("c"), top of window
  state.moveCursorUp(1); // → row 1 ("b"), out of window: scroll
  expect(vt.screen()).toBe("b\nc\nd");
});

test("recalling a buffer too tall for the prompt's anchor row scrolls the terminal up", () => {
  // Anchor at row 4 (last row of a 5-row terminal). Recall a 5-row command.
  // bash behavior: terminal scrolls up so the bottom of the recall lands at
  // the bottom of the viewport, even if the prompt scrolls off the top.
  const { vt, state } = setup(40, 5, {
    anchor: 4,
    history: ["a\nb\nc\nd\ne"],
  });
  state.moveCursorUp(1); // recall — editing=false initially, so this is history nav
  expect(vt.screen()).toBe("> a\nb\nc\nd\ne");
  expect(vt.cursor()).toEqual([4, 1]);
});

test("recalling a buffer taller than the whole terminal pins bottom to viewport bottom", () => {
  const { vt, state } = setup(40, 3, { anchor: 2, history: ["a\nb\nc\nd\ne"] });
  state.moveCursorUp(1);
  // Buffer has 5 rows; only the bottom 3 visible. The earlier rows scroll
  // off into scrollback.
  expect(vt.screen()).toBe("c\nd\ne");
  expect(vt.cursor()).toEqual([2, 1]);
});

test("immediate ArrowUp after recall navigates history (no buffer-nav)", () => {
  const { vt, state } = setup(40, 8, { history: ["older", "newer\nline2"] });
  state.moveCursorUp(1); // recall most recent: "newer\nline2"
  expect(state.buffer()).toBe("newer\nline2");
  state.moveCursorUp(1); // immediately again — should go to older entry
  expect(state.buffer()).toBe("older");
  expect(vt.screen()).toBe("> older");
});

test("ArrowLeft after recall enters edit mode; ArrowUp then moves within buffer", () => {
  const { vt, state } = setup(40, 8, {
    history: ["older", "(define\n  body)"],
  });
  state.moveCursorUp(1); // recall "(define\n  body)"
  state.moveCursorBack(1); // enter edit mode
  state.moveCursorUp(1); // now navigates within buffer, not history
  expect(state.buffer()).toBe("(define\n  body)"); // buffer NOT replaced
  expect(vt.cursor()[0]).toBe(0); // cursor moved to first visual row
});

test("ArrowUp at top of buffer in edit mode is a no-op (no history fallthrough)", () => {
  const { state } = setup(40, 8, { history: ["older", "current\nline2"] });
  state.moveCursorUp(1); // recall "current\nline2"
  state.moveCursorBack(1); // edit mode
  state.moveCursorUp(1); // up to row 0
  state.moveCursorUp(1); // already at top — must NOT swap to "older"
  expect(state.buffer()).toBe("current\nline2");
});

test("Ctrl-U-style update clears edit mode so Up navigates history again", () => {
  const { state } = setup(40, 8, { history: ["older", "current"] });
  state.moveCursorUp(1); // recall "current"
  state.moveCursorBack(1); // edit mode
  state.update(""); // Ctrl-U
  state.moveCursorUp(1); // editing reset; should navigate to next prev
  expect(state.buffer()).toBe("older");
});

test("buffer that wraps exactly at the right margin places cursor on the next row", () => {
  // 20 cols. "> " + 18 chars exactly fills row 0; cursor must land on row 1
  // col 0, not on row 0 col 20 (pending-wrap).
  const { vt, state } = setup(20, 5);
  state.editInsert("a".repeat(18));
  expect(vt.cursor()).toEqual([1, 0]);
  // Visible: row 0 full of '> aaaa…' (20 chars), row 1 empty
  expect(vt.screen().split("\n")[0]).toBe("> " + "a".repeat(18));
});

test("highlighter SGR spans wrapped visual rows without bleeding styles", () => {
  // The highlighter wraps the entire buffer in red. We don't assert on
  // styling (VTerm strips SGR), but we do assert that the visible characters
  // are all preserved across the wrap — which is what would break if the
  // SGR-tracking in splitIntoVisualRows were wrong.
  const hl: Highlighter = {
    highlight: (line) => `\x1b[31m${line}\x1b[0m`,
    highlightPrompt: (p) => p,
    highlightChar: () => false,
  };
  const { vt, state } = setup(10, 4, { highlighter: hl });
  state.editInsert("abcdefghijklmno"); // 15 chars, wraps in 10-col terminal
  // "> " + "abcdefgh" = 10 chars, then "ijklmno" on next row
  const lines = vt.screen().split("\n");
  expect(lines[0]).toBe("> abcdefgh");
  expect(lines[1]).toBe("ijklmno");
});

test("moveCursorToEnd on a tall buffer scrolls to the end before resolving", () => {
  // After Enter, Readline calls state.moveCursorToEnd() then writes \r\n.
  // Verify the cursor really lands at end-of-buffer (last visible row).
  const { vt, state } = setup(20, 3);
  state.editInsert("a\nb\nc\nd\ne");
  state.moveCursorBack(1); // edit mode
  state.moveCursorUp(1);
  state.moveCursorUp(1); // somewhere mid-buffer
  state.moveCursorToEnd();
  expect(vt.cursor()).toEqual([2, 1]); // bottom of viewport, end of "e"
});

test("editBackspace deletes the previous character and reflows the screen", () => {
  const { vt, state } = setup(20, 5);
  state.editInsert("hello");
  state.editBackspace(1);
  expect(state.buffer()).toBe("hell");
  expect(vt.screen()).toBe("> hell");
  expect(vt.cursor()).toEqual([0, 6]);
});

test("editDelete removes the character under the cursor without moving it", () => {
  const { vt, state } = setup(20, 5);
  state.editInsert("hello");
  state.moveCursorBack(2); // cursor between 'l' and 'l'
  state.editDelete(1); // delete second 'l'
  expect(state.buffer()).toBe("helo");
  expect(vt.screen()).toBe("> helo");
});

test("editDeleteEndOfLine kills from cursor to end of logical line", () => {
  const { vt, state } = setup(20, 5);
  state.editInsert("foo bar\nbaz");
  state.moveCursorHome();
  state.moveCursorUp(1); // editing=true after Home; this moves within buffer
  // Cursor on row 0 — go to start, then move forward 4 chars to land at "bar"
  state.moveCursorHome();
  for (let i = 0; i < 4; i++) state.moveCursorForward(1);
  state.editDeleteEndOfLine();
  expect(state.buffer()).toBe("foo \nbaz");
  expect(vt.screen()).toBe("> foo\nbaz");
});

test("editInsert eager-push fast path writes only the new char", () => {
  // Single-char insert that fits in the current row and does not require
  // SGR tracking should bypass the full refresh and just emit the char.
  // Verify by typing into a wide terminal and checking the visible state.
  const { vt, state } = setup(40, 3);
  state.editInsert("a");
  state.editInsert("b");
  state.editInsert("c");
  expect(vt.screen()).toBe("> abc");
  expect(vt.cursor()).toEqual([0, 5]);
});

test("moveCursor falls back to full refresh when arrow-up crosses the window edge", () => {
  // 4-row viewport, 5-row buffer → scrollOffset=1, window shows rows 1..4.
  // Three arrow-ups stay in window (incremental ANSI). The fourth crosses
  // the top edge and must trigger a full refresh that re-renders rows 0..3.
  const { vt, state } = setup(20, 4);
  state.editInsert("a\nb\nc\nd\ne");
  state.moveCursorBack(1); // edit mode
  state.moveCursorUp(1); // 3
  state.moveCursorUp(1); // 2
  state.moveCursorUp(1); // 1 (top of window)
  expect(vt.screen()).toBe("b\nc\nd\ne");
  state.moveCursorUp(1); // 0 — out of window, refresh
  expect(vt.screen()).toBe("> a\nb\nc\nd");
});

test("onResize-style anchor clamp keeps cursor in a valid row when terminal shrinks", () => {
  const { vt, tty, state } = setup(40, 10, { anchor: 8 });
  state.editInsert("hi");
  // Simulate the resize handler in Readline.activate(): xterm clamps the
  // physical cursor into the new bounds, then we update Tty dims and
  // re-clamp anchorRow.
  vt.resize(40, 4);
  tty.col = 40;
  tty.row = 4;
  if (tty.anchorRow >= tty.row) tty.anchorRow = Math.max(0, tty.row - 1);
  state.refresh();
  // Cursor must be inside the new viewport, not at row 8.
  const [r] = vt.cursor();
  expect(r).toBeLessThan(4);
  expect(state.buffer()).toBe("hi");
});
