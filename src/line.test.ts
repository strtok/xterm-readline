import { LineBuffer } from "./line";

test("previous position", () => {
  {
    const line = new LineBuffer();
    line.insert("foo");
    line.set_pos(0);
    expect(line.prevPos(1)).toBeUndefined();
  }
  {
    const line = new LineBuffer();
    line.insert("foo");
    expect(line.prevPos(1)).toBe(2);
    expect(line.prevPos(2)).toBe(1);
    expect(line.prevPos(3)).toBe(0);
    expect(line.prevPos(4)).toBe(0);
  }
  {
    const line = new LineBuffer();
    line.insert("foobar");
    line.set_pos(3);
    expect(line.prevPos(1)).toBe(2);
    expect(line.prevPos(2)).toBe(1);
    expect(line.prevPos(3)).toBe(0);
    expect(line.prevPos(4)).toBe(0);
  }
  {
    const line = new LineBuffer();
    line.insert("fo🐕");
    expect(line.prevPos(1)).toBe(2);
  }
});

test("backspace", () => {
  {
    const line = new LineBuffer();
    line.insert("foobar");
    expect(line.backspace(3)).toBeTruthy();
    expect(line.buffer()).toBe("foo");
  }
  {
    const line = new LineBuffer();
    line.insert("fo🐕");
    expect(line.backspace(1)).toBeTruthy();
    expect(line.buffer()).toBe("fo");
  }
});


test("deleteEndOfLine", () => {
  {
    const line = new LineBuffer();
    line.insert("foobar");
    expect(line.moveBack(3)).toBeTruthy();
    expect(line.buffer()).toBe("foobar");
    expect(line.deleteEndOfLine()).toBeTruthy();
    expect(line.buffer()).toBe("foo");
  }

  {
    const line = new LineBuffer();
    line.insert("foo\nbar");

    expect(line.moveLineUp(1)).toBeTruthy();
    expect(line.buffer()).toBe("foo\nbar");
    expect(line.moveBack(2)).toBeTruthy();
    expect(line.deleteEndOfLine()).toBeTruthy();
    expect(line.buffer()).toBe("f\nbar");

    expect(line.moveLineDown(1)).toBeTruthy();
    expect(line.deleteEndOfLine()).toBeTruthy();
    expect(line.buffer()).toBe("f\nb");
  }
});

test("moveLineUp accounts for prompt offset on line 0", () => {
  const line = new LineBuffer();
  // Buffer line 0 is "abcde" (rendered after a 2-col prompt → visual cols
  // 2..6). Buffer line 1 is "wxyz". Cursor at end of line 1, visual col 4.
  line.insert("abcde\nwxyz");

  expect(line.moveLineUp(1, 2)).toBeTruthy();
  // Visual col 4 on line 0 = buffer col 4 - 2 = 2 → cursor before 'c'.
  expect(line.pos).toBe(2);
});

test("moveLineDown accounts for prompt offset on line 0", () => {
  const line = new LineBuffer();
  line.insert("abcde\nwxyz");
  // Move cursor to buffer pos 4 on line 0 ("abcd|e"). Visual col 6
  // (= 4 + promptCols 2).
  line.moveBack(line.length() - 4);
  expect(line.pos).toBe(4);

  expect(line.moveLineDown(1, 2)).toBeTruthy();
  // Visual col 6 on line 1 → buffer col 6, but line 1 only has 4 chars,
  // so cursor lands at end of line 1.
  expect(line.pos).toBe(line.length());

  // Now repeat with a smaller column so we stay inside line 1.
  const line2 = new LineBuffer();
  line2.insert("abcde\nwxyz");
  line2.moveBack(line2.length() - 1); // pos 1, visual col 3
  expect(line2.pos).toBe(1);
  expect(line2.moveLineDown(1, 2)).toBeTruthy();
  // Visual col 3 on line 1 = buffer col 3 → between 'y' and 'z'.
  expect(line2.pos).toBe(6 + 3); // "abcde\n" = 6, then 3 chars in
});

test("moveLineUp/Down without prompt offset matches char count (existing behavior)", () => {
  const line = new LineBuffer();
  line.insert("abcde\nwxyz");
  expect(line.moveLineUp(1)).toBeTruthy(); // default promptCols = 0
  // Visual col 4 → buffer col 4 on line 0 (between 'd' and 'e').
  expect(line.pos).toBe(4);
});
