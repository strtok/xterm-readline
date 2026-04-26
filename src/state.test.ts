import { IdentityHighlighter } from "./highlight";
import { History } from "./history";
import { State } from "./state";
import { Tty } from "./tty";

const PROMPT = "> ";

class Output {
  output: string[] = [];
  write = jest.fn((text: string) => this.output.push(text));
  print = jest.fn((text: string) => this.output.push(text));
  println = jest.fn((text: string) => this.output.push(text));
}

test("edit insert push", () => {
  const out = new Output();
  const tty = new Tty(80, 24, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  state.editInsert("a");
  state.editInsert("b");
  state.editInsert("c");
  expect(state.buffer()).toBe("abc");
  expect(out.write).toHaveBeenNthCalledWith(1, "a");
  expect(out.write).toHaveBeenNthCalledWith(2, "b");
  expect(out.write).toHaveBeenNthCalledWith(3, "c");
});

test("edit insert", () => {
  const out = new Output();
  const tty = new Tty(80, 24, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  state.editInsert("a");
  state.editInsert("b");
  state.editInsert("c");
  state.moveCursorBack(1);
  state.editInsert("d");
  expect(state.buffer()).toBe("abdc");
});

test("edit insert wrap", () => {
  const out = new Output();
  const tty = new Tty(5, 24, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  state.editInsert("a");
  state.editInsert("b");
  state.editInsert("c");
  state.editInsert("d");
  expect(state.buffer()).toBe("abcd");
  expect(out.write).toHaveBeenNthCalledWith(1, "a");
  expect(out.write).toHaveBeenNthCalledWith(2, "b");
  expect(out.write).toHaveBeenNthCalledWith(3, "c");
  expect(out.write).toHaveBeenNthCalledWith(4, "d");

  out.write.mockClear();
  state.editInsert("e");
  expect(state.buffer()).toBe("abcde");
  // New windowed renderer: erase from anchor down with \x1b[J, emit each
  // visual row separated by \r\n with an SGR reset at row end, then position
  // cursor at the new (row,col) within the viewport.
  expect(out.write).toHaveBeenNthCalledWith(1, "\r\x1B[J");
  expect(out.write).toHaveBeenNthCalledWith(2, "> abc");
  expect(out.write).toHaveBeenNthCalledWith(3, "\x1B[0m");
  expect(out.write).toHaveBeenNthCalledWith(4, "\r\n");
  expect(out.write).toHaveBeenNthCalledWith(5, "de");
  expect(out.write).toHaveBeenNthCalledWith(6, "\x1B[0m");
  expect(out.write).toHaveBeenNthCalledWith(7, "\r\x1B[2C");
});

test("edit multiline backcursor", () => {
  const out = new Output();
  const tty = new Tty(5, 24, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  state.editInsert("a");
  state.editInsert("\n");
  state.editInsert("b");
  state.editInsert("\n");
  state.editInsert("c");
  state.moveCursorBack(1);
  state.moveCursorBack(1);
  state.editInsert("d");
  state.editBackspace(1);
  expect(state.buffer()).toBe("a\nb\nc");
});

test("buffer taller than viewport scrolls window to cursor", () => {
  const out = new Output();
  // 80 cols, 3 rows — anything past 3 visual rows must be windowed
  const tty = new Tty(80, 3, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  // Insert 5 logical lines of content (5 visual rows including prompt)
  state.editInsert("a\nb\nc\nd\ne");
  expect(state.buffer()).toBe("a\nb\nc\nd\ne");

  // After the multiline insert, cursor is at end (row 4, col 1 in virtual coords).
  // Viewport is 3 rows so scrollOffset must be 2 — only rows 2,3,4 emitted:
  // "c", "d", "e".
  const writes = out.write.mock.calls.map((c) => c[0]);
  // Must emit the bottom three rows
  expect(writes).toContain("c");
  expect(writes).toContain("d");
  expect(writes).toContain("e");
  // Must NOT emit rows that were scrolled out of the window
  expect(writes).not.toContain("> a");
  expect(writes).not.toContain("b");
});

test("moveCursorUp past top of window triggers refresh and scrolls", () => {
  const out = new Output();
  const tty = new Tty(80, 3, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  state.editInsert("a\nb\nc\nd\ne");
  // Viewport now shows rows 2,3,4 ("c","d","e"); cursor at row 4.
  out.write.mockClear();
  // Move up four times — second move crosses out of viewport, should refresh.
  state.moveCursorUp(1); // row 3, in window
  state.moveCursorUp(1); // row 2, in window
  state.moveCursorUp(1); // row 1, OUT of window → refresh, scroll
  const writes = out.write.mock.calls.map((c) => c[0]);
  // adjustScroll places the cursor at the top of the window, so scrollOffset
  // becomes 1 — window now shows rows 1,2,3 ("b","c","d"), and "e" drops out.
  expect(writes).toContain("b");
  expect(writes).toContain("c");
  expect(writes).toContain("d");
  expect(writes).not.toContain("e");
});

test("single-viewport behavior unchanged for short buffers", () => {
  const out = new Output();
  const tty = new Tty(80, 24, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  // No scrolling needed: buffer fits comfortably in 24 rows.
  state.editInsert("a\nb\nc");
  // scrollOffset stays 0
  expect(out.write).toHaveBeenCalled();
  // Cursor is on virtual row 2 col 1; viewportRows=24, so window covers all.
  // No \x1b[A produced for moving up to anchor (we were at row 0 before
  // refresh) — the refresh starts with \r\x1b[J.
  const calls = out.write.mock.calls.map((c) => c[0]);
  expect(calls[0]).toBe("\r\x1b[J");
});

test("cursor arrow movement", () => {
  const out = new Output();
  const tty = new Tty(5, 24, 8, out);
  const state = new State(
    PROMPT,
    tty,
    new IdentityHighlighter(),
    new History(50)
  );
  state.editInsert("abc\ndef\nghi");
  state.moveCursorBack(1);
  state.moveCursorUp(1);
  state.editInsert("z");
  expect(state.buffer()).toEqual("abc\ndezf\nghi");
  state.moveCursorForward(1);
  state.moveCursorDown(1);
  state.editInsert("y");
  expect(state.buffer()).toEqual("abc\ndezf\nghiy");
});

class BracketHighlighter {
  highlight(line: string, _pos: number): string {
    // Wrap every '(' in a fake SGR so the test can detect highlighting.
    return line.replace(/\(/g, "\x1b[1;33m(\x1b[0m");
  }
  highlightPrompt(prompt: string): string {
    return prompt;
  }
  highlightChar(_line: string, _pos: number): boolean {
    return false;
  }
}

test("refreshUnhighlighted strips highlighter SGR", () => {
  const out = new Output();
  const tty = new Tty(80, 24, 8, out);
  const state = new State(PROMPT, tty, new BracketHighlighter(), new History(50));
  state.editInsert("(foo)");

  // Sanity: a normal refresh emits the highlighted form.
  out.output.length = 0;
  state.refresh();
  expect(out.output.join("")).toContain("\x1b[1;33m(\x1b[0m");

  // refreshUnhighlighted writes the plain buffer.
  out.output.length = 0;
  state.refreshUnhighlighted();
  const written = out.output.join("");
  expect(written).toContain("(foo)");
  expect(written).not.toContain("\x1b[1;33m");

  // The highlighter is restored after the unhighlighted refresh.
  out.output.length = 0;
  state.refresh();
  expect(out.output.join("")).toContain("\x1b[1;33m(\x1b[0m");
});
