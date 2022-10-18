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
