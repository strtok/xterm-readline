import { VTerm } from "./vterm";

test("plain text writes to grid and advances cursor", () => {
  const t = new VTerm(10, 3);
  t.write("hello");
  expect(t.screen()).toBe("hello");
  expect(t.cursor()).toEqual([0, 5]);
});

test("\\r\\n moves to next line at column 0", () => {
  const t = new VTerm(10, 3);
  t.write("ab\r\ncd");
  expect(t.screen()).toBe("ab\ncd");
  expect(t.cursor()).toEqual([1, 2]);
});

test("auto-wrap at right margin uses pending-wrap, not eager wrap", () => {
  const t = new VTerm(5, 3);
  t.write("abcde"); // fills row 0; cursor parked at col 4 with pending wrap
  expect(t.screen()).toBe("abcde");
  expect(t.cursor()).toEqual([0, 4]);
  t.write("f"); // first new char wraps
  expect(t.screen()).toBe("abcde\nf");
  expect(t.cursor()).toEqual([1, 1]);
});

test("\\r cancels pending wrap", () => {
  const t = new VTerm(5, 3);
  t.write("abcde");
  t.write("\r");
  t.write("X");
  expect(t.screen()).toBe("Xbcde");
  expect(t.cursor()).toEqual([0, 1]);
});

test("CUU/CUD/CUF/CUB clamp at edges", () => {
  const t = new VTerm(10, 3);
  t.write("\x1b[5A"); // up past top
  expect(t.cursor()).toEqual([0, 0]);
  t.write("\x1b[5B");
  expect(t.cursor()).toEqual([2, 0]);
  t.write("\x1b[20C");
  expect(t.cursor()).toEqual([2, 9]);
  t.write("\x1b[20D");
  expect(t.cursor()).toEqual([2, 0]);
});

test("\\x1b[J erases from cursor to end of display", () => {
  const t = new VTerm(5, 3);
  t.write("abcde\r\nfghij\r\nkl");
  t.write("\x1b[2A"); // up to row 0, col 2
  // cursor lands at (0, 2) after CUU; the previous content put us at (2,2)
  expect(t.cursor()).toEqual([0, 2]);
  t.write("\x1b[J");
  expect(t.screen()).toBe("ab");
});

test("LF at last row scrolls and pushes the top row into scrollback", () => {
  const t = new VTerm(5, 2);
  t.write("aaa\r\nbbb\r\n");
  expect(t.scrollback.length).toBe(1);
  expect(t.scrollback[0].join("")).toBe("aaa  ");
  expect(t.screen()).toBe("bbb");
});

test("SGR sequences are ignored for visible output", () => {
  const t = new VTerm(10, 1);
  t.write("\x1b[1;31mhi\x1b[0m there");
  expect(t.screen()).toBe("hi there");
});
