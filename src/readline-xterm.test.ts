/** @jest-environment node */
import { Terminal } from "@xterm/xterm";
import { Readline } from "./readline";
import { History } from "./history";

// Buffer-only xterm tests do not need a DOM or browser history storage.
beforeEach(() => {
  jest
    .spyOn(History.prototype, "restoreFromLocalStorage")
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
