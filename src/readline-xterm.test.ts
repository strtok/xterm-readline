/** @jest-environment node */
import { Terminal } from "@xterm/xterm";
import { Readline } from "./readline";
import { History } from "./history";

// Buffer-only xterm tests do not need a DOM or browser history storage.
beforeEach(() => {
  jest
    .spyOn(History.prototype, "restoreFromLocalStorage")
    .mockImplementation(() => {});
  jest
    .spyOn(History.prototype, "saveToLocalStorage")
    .mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

test.each(["Hello ", "1234567890"])(
  "real xterm preserves preceding output %j after buffered writes",
  async (prefix) => {
    const term = new Terminal({ cols: 10, rows: 5 });
    const rl = new Readline();
    term.loadAddon(rl);
    term.write(prefix);
    rl.read("> ");
    // Drain the initial anchor callback, optional wrap, and redraw writes.
    for (let i = 0; i < 3; i++) {
      await new Promise<void>((resolve) => term.write("", resolve));
    }
    const buffer = term.buffer.active;
    expect(buffer.getLine(0)?.translateToString(true).trimEnd()).toBe(
      prefix.length === 10 ? prefix : "Hello >"
    );
    expect(buffer.cursorY).toBe(prefix.length === 10 ? 1 : 0);
    expect(buffer.cursorX).toBe(prefix.length === 10 ? 2 : 8);
    term.dispose();
  }
);

// Wait for xterm's buffered writes (and any writes they trigger) to land.
async function drain(term: Terminal) {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((resolve) => term.write("", resolve));
  }
}

function screen(term: Terminal, rows: number): string[] {
  const buffer = term.buffer.active;
  return Array.from(
    { length: rows },
    (_, i) => buffer.getLine(i)?.translateToString(true) ?? ""
  );
}

function viewport(term: Terminal): string[] {
  const buffer = term.buffer.active;
  return Array.from(
    { length: term.rows },
    (_, i) => buffer.getLine(buffer.viewportY + i)?.translateToString(true) ?? ""
  );
}

async function startRead(cols: number, prefix: string, keys: string[]) {
  const term = new Terminal({ cols, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  term.write(prefix);
  rl.read("> ");
  await drain(term);
  for (const key of keys) {
    term.input(key);
    await drain(term);
  }
  return term;
}

test("Ctrl-C away from the end of the line starts the next prompt at column 0", async () => {
  const term = await startRead(40, "", ["abcdef", "\x1b[D", "\x1b[D", "\x03"]);
  expect(screen(term, 2)).toEqual(["> abcdef^C", "> "]);
  expect(term.buffer.active.cursorY).toBe(1);
  expect(term.buffer.active.cursorX).toBe(2);
  term.dispose();
});

test.each([40, 21, 20, 19])(
  "emoji prompt agrees with xterm before and after Backspace at %i columns",
  async (cols) => {
    const prompt = "example terminal: 🚀>";
    const term = new Terminal({ cols, rows: 8 });
    const reference = new Terminal({ cols, rows: 8 });
    const rl = new Readline();
    term.loadAddon(rl);
    rl.read(prompt);
    await drain(term);
    term.input("abc");
    await drain(term);
    term.input("\x7f");
    await drain(term);
    reference.write(prompt + "ab");
    await drain(reference);
    expect(screen(term, 4)).toEqual(screen(reference, 4));
    expect(term.buffer.active.cursorX).toBe(reference.buffer.active.cursorX);
    expect(term.buffer.active.cursorY).toBe(reference.buffer.active.cursorY);
    term.input("\x1b[D");
    term.input("X");
    await drain(term);
    expect(rl.getLine()).toBe("aXb");
    term.dispose();
    reference.dispose();
  }
);

test("measured prompt retains ANSI styling, explicit newlines, and trailing spaces", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  rl.setHighlighter({
    highlight: (text) => text,
    highlightChar: () => false,
    highlightPrompt: (prompt) => `\x1b[32m${prompt}\x1b[0m`,
  });
  rl.read("🚀\n> ");
  await drain(term);
  term.input("abc");
  term.input("\x7f");
  await drain(term);
  expect(screen(term, 2)).toEqual(["🚀", "> ab"]);
  expect(term.buffer.active.getLine(0)?.getCell(0)?.getFgColor()).toBe(2);
  expect(term.buffer.active.getLine(1)?.getCell(0)?.getFgColor()).toBe(2);
  expect(term.buffer.active.cursorX).toBe(4);
  expect(term.buffer.active.cursorY).toBe(1);
  term.dispose();
});

test("keys arriving while the prompt is measured are retained", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  rl.read("example terminal: 🚀>");
  term.input("abc");
  term.input("\x7f");
  await drain(term);
  expect(screen(term, 1)).toEqual(["example terminal: 🚀>ab"]);
  expect(term.buffer.active.cursorX).toBe(22);
  term.dispose();
});

test("Ctrl-L remeasures the prompt and retains the input cursor", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  term.write("banner\r\nprefix ");
  rl.read("🚀>");
  await drain(term);
  term.input("abc");
  term.input("\x1b[D");
  term.input("\x0c");
  term.input("X");
  await drain(term);
  expect(screen(term, 2)).toEqual(["🚀>abXc", ""]);
  expect(term.buffer.active.cursorX).toBe(5);
  term.dispose();
});

test.each([[40, 15], [15, 40]])(
  "resize from %i to %i columns redraws and remeasures the emoji prompt",
  async (cols, nextCols) => {
    const prompt = "example terminal: 🚀>";
    const term = new Terminal({ cols, rows: 8 });
    const reference = new Terminal({ cols: nextCols, rows: 8 });
    const rl = new Readline();
    term.loadAddon(rl);
    rl.read(prompt);
    await drain(term);
    term.input("abc");
    await drain(term);
    term.resize(nextCols, 8);
    term.input("\x7f");
    await drain(term);
    reference.write(prompt + "ab");
    await drain(reference);
    expect(screen(term, 4)).toEqual(screen(reference, 4));
    expect(term.buffer.active.cursorX).toBe(reference.buffer.active.cursorX);
    expect(term.buffer.active.cursorY).toBe(reference.buffer.active.cursorY);
    term.dispose();
    reference.dispose();
  }
);

test("returning from a clipped input window restores the measured prompt", async () => {
  const term = new Terminal({ cols: 30, rows: 3 });
  const rl = new Readline();
  term.loadAddon(rl);
  rl.read("example terminal: 🚀>");
  await drain(term);
  // A pasted carriage return is inserted as a newline, so five input rows
  // overflow the three-row viewport and clip the prompt row.
  term.input("a\rb\rc\rd\re");
  await drain(term);
  expect(rl.getLine()).toBe("a\nb\nc\nd\ne");
  expect(viewport(term)).toEqual(["c", "d", "e"]);
  term.input("\x15");
  await drain(term);
  expect(viewport(term)).toEqual(["example terminal: 🚀>", "", ""]);
  expect(term.buffer.active.cursorX).toBe(20);
  term.dispose();
});

test("re-activating on another terminal mid-prompt does not swallow input", async () => {
  const first = new Terminal({ cols: 40, rows: 8 });
  const second = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  first.loadAddon(rl);
  rl.read("> ");
  // Move to the second terminal before the first prompt print completes.
  second.loadAddon(rl);
  await drain(first);
  second.input("\x03");
  await drain(second);
  expect(screen(second, 2)).toEqual(["> ^C", "> "]);
  expect(second.buffer.active.cursorX).toBe(2);
  first.dispose();
  second.dispose();
});

test("updateLine after a clipped read completes still redraws the input", async () => {
  const term = new Terminal({ cols: 30, rows: 3 });
  const rl = new Readline();
  term.loadAddon(rl);
  rl.read("> ");
  await drain(term);
  term.input("a\rb\rc\rd\re");
  await drain(term);
  term.input("\r");
  await drain(term);
  rl.updateLine("x");
  await drain(term);
  expect(rl.getLine()).toBe("x");
  // The finished read's prompt is not reprinted, but the input is drawn and
  // the cursor follows it rather than staying on a stale layout.
  const buffer = term.buffer.active;
  const row = viewport(term)[buffer.cursorY];
  expect(row.endsWith("x")).toBe(true);
  expect(buffer.cursorX).toBe(row.length);
  term.dispose();
});
