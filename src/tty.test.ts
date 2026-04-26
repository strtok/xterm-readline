import { IdentityHighlighter } from "./highlight";
import { LineBuffer } from "./line";
import { Layout, Position } from "./state";
import { Tty } from "./tty";

class Output {
  output: string[] = [];
  write = jest.fn((text: string) => this.output.push(text));
  print = jest.fn((text: string) => this.output.push(text));
  println = jest.fn((text: string) => this.output.push(text));
}

test("splitIntoVisualRows wraps on cols boundary", () => {
  const tty = new Tty(5, 24, 8, new Output());
  expect(tty.splitIntoVisualRows("abcdefgh")).toEqual(["abcde", "fgh"]);
});

test("splitIntoVisualRows pushes a trailing empty row when buffer ends at cols", () => {
  const tty = new Tty(5, 24, 8, new Output());
  // 5 chars exactly fills row 0; mirrors calculatePosition's (row+1, 0)
  // normalization so the renderer's row count matches Layout.end.row.
  expect(tty.splitIntoVisualRows("abcde")).toEqual(["abcde", ""]);
});

test("splitIntoVisualRows splits on \\n", () => {
  const tty = new Tty(80, 24, 8, new Output());
  expect(tty.splitIntoVisualRows("foo\nbar\nbaz")).toEqual([
    "foo",
    "bar",
    "baz",
  ]);
});

test("splitIntoVisualRows re-applies active SGR at the start of wrapped rows", () => {
  const tty = new Tty(5, 24, 8, new Output());
  // "\x1b[31m" colors text red; the wrap point is between 'd' and 'e'.
  // Row 1 must be prefixed with the active SGR so the styling carries
  // across the visual row boundary.
  const rows = tty.splitIntoVisualRows("\x1b[31mabcdef\x1b[0m");
  expect(rows[0]).toBe("\x1b[31mabcde");
  expect(rows[1]).toBe("\x1b[31mf\x1b[0m");
});

test("splitIntoVisualRows resets SGR tracking on \\x1b[0m", () => {
  const tty = new Tty(5, 24, 8, new Output());
  // Style ends mid-row, then we wrap. Row 1 must NOT inherit the SGR.
  const rows = tty.splitIntoVisualRows("\x1b[31mab\x1b[0mcdef");
  expect(rows[0]).toBe("\x1b[31mab\x1b[0mcde");
  expect(rows[1]).toBe("f");
});

test("splitIntoVisualRows expands tab to next tabstop", () => {
  // tabWidth=4. "a\tb" → 'a' col 1, '\t' to col 4 (3 spaces wide), 'b' col 5.
  const tty = new Tty(80, 24, 4, new Output());
  const rows = tty.splitIntoVisualRows("a\tb");
  expect(rows).toEqual(["a\tb"]);
  expect(tty.calculatePosition("a\tb", new Position(0, 0))).toEqual(
    new Position(0, 5)
  );
});

test("splitIntoVisualRows handles double-width characters at the wrap boundary", () => {
  // 5-col terminal, "中" has width 2. "ab中cd" → 'a','b','中' fills cols 1..4
  // (中 occupies cols 3-4); 'c' at col 5 stays on row 0; 'd' wraps. With my
  // wrap rule (col + cw > cols), 'c' at col 4+1=5 fits, 'd' at 5+1=6 wraps.
  const tty = new Tty(5, 24, 8, new Output());
  const rows = tty.splitIntoVisualRows("ab中cd");
  expect(rows[0]).toBe("ab中c");
  expect(rows[1]).toBe("d");
});

test("calculate position", () => {
  const orig = new Position(0, 0);
  const tty = new Tty(80, 24, 8, new Output());

  expect(tty.calculatePosition("foo", orig)).toEqual(new Position(0, 3));

  expect(tty.calculatePosition("\x1b[1;32mfoo", orig)).toEqual(
    new Position(0, 3)
  );

  expect(tty.calculatePosition("foo\nbar", orig)).toEqual(new Position(1, 3));
});

test("refreshLine wraps emit in cursor-hide/show", () => {
  const out = new Output();
  const tty = new Tty(80, 24, 8, out);
  const line = new LineBuffer();
  line.update("hello\nworld", 11);

  const oldLayout = new Layout(new Position(0, 0));
  const newLayout = new Layout(new Position(0, 0));
  newLayout.cursor = new Position(1, 5);
  newLayout.end = new Position(1, 5);

  tty.refreshLine("> ", line, oldLayout, newLayout, new IdentityHighlighter());

  const emitted = out.output.join("");
  expect(emitted.startsWith("\x1b[?25l")).toBe(true);
  expect(emitted.endsWith("\x1b[?25h")).toBe(true);
});
