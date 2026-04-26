// Integration tests for Readline against a stub xterm-like Terminal that
// exposes onData, onResize, attachCustomKeyEventHandler, write(text, cb),
// and a buffer.active.cursorY readable as the last LF row written. These
// cover the read()-time anchor flush and the onResize end-to-end path.

import { Readline } from "./readline";
import { VTerm } from "./vterm";

class StubTerminal {
  public cols: number;
  public rows: number;
  public options = { tabStopWidth: 8 } as { tabStopWidth?: number };
  public buffer = {
    active: {
      get cursorY() {
        return this.parent.vt.cursor()[0];
      },
      parent: null as unknown as StubTerminal,
    },
  };
  public vt: VTerm;
  private onDataHandlers: ((data: string) => void)[] = [];
  private onResizeHandlers: ((s: { cols: number; rows: number }) => void)[] =
    [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.vt = new VTerm(cols, rows);
    this.buffer.active.parent = this;
  }

  onData(h: (data: string) => void) {
    this.onDataHandlers.push(h);
    return { dispose: () => {} };
  }

  onResize(h: (s: { cols: number; rows: number }) => void) {
    this.onResizeHandlers.push(h);
    return { dispose: () => {} };
  }

  attachCustomKeyEventHandler(_fn: (e: KeyboardEvent) => boolean) {
    // unused in these tests
  }

  write(text: string, cb?: () => void) {
    this.vt.write(text);
    // Fire the callback synchronously so tests can read state immediately.
    // (The real xterm fires asynchronously; the production code only relies
    // on cb running *after* the buffer is updated, which holds either way.)
    if (cb) cb();
  }

  resize(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.vt.resize(cols, rows);
    for (const h of this.onResizeHandlers) h({ cols, rows });
  }

  feedData(data: string) {
    for (const h of this.onDataHandlers) h(data);
  }
}

test("read() samples cursorY *after* prior writes have flushed", () => {
  const term = new StubTerminal(20, 6);
  const rl = new Readline();
  rl.activate(term as unknown as Parameters<typeof rl.activate>[0]);

  // Print a banner before read(); cursorY should advance through the buffer.
  rl.println("line1");
  rl.println("line2");
  rl.println("line3");
  // Synchronously call read(); our stub's write callback fires immediately,
  // but in production read() is wrapped in term.write("", cb) precisely so
  // the anchor isn't sampled before flush. Verify the prompt lands on the
  // row directly under the banner, not on top of it.
  rl.read("> ");
  // Trailing spaces are trimmed by VTerm.screen(); check cursor position
  // directly to confirm the prompt landed under the banner, not on top.
  expect(term.vt.screen().split("\n").slice(0, 3)).toEqual([
    "line1",
    "line2",
    "line3",
  ]);
  expect(term.vt.cursor()).toEqual([3, 2]);
});

test("typing through onData drives State and updates the screen", async () => {
  const term = new StubTerminal(20, 6);
  const rl = new Readline();
  rl.activate(term as unknown as Parameters<typeof rl.activate>[0]);

  const promise = rl.read("> ");
  // Yield once so read()'s internal term.write("", cb) callback runs and
  // the State is constructed before we feed input.
  await Promise.resolve();

  for (const ch of "hello") term.feedData(ch);
  expect(term.vt.screen()).toBe("> hello");
  term.feedData("\r"); // Enter
  expect(await promise).toBe("hello");
});

test("onResize re-fits Tty and re-renders the active read", () => {
  const term = new StubTerminal(40, 8);
  const rl = new Readline();
  rl.activate(term as unknown as Parameters<typeof rl.activate>[0]);

  rl.read("> ");
  for (const ch of "abc") term.feedData(ch);
  expect(term.vt.screen()).toBe("> abc");

  // Shrink to 20x4 — the rendered buffer should still be visible and valid.
  term.resize(20, 4);
  expect(term.vt.screen()).toBe("> abc");
  expect(term.vt.cursor()).toEqual([0, 5]);
});
