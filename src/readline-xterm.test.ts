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
