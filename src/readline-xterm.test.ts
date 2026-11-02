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

test("by default the Ctrl-C handler only runs between reads", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  const handler = jest.fn();
  term.loadAddon(rl);
  rl.setCtrlCHandler(handler);
  const read = rl.read("> ");
  await drain(term);
  term.input("abc");
  term.input("\x03");
  await drain(term);
  expect(handler).not.toHaveBeenCalled();
  expect(screen(term, 2)).toEqual(["> abc^C", "> "]);
  term.input("\r");
  expect(await read).toBe("");
  await drain(term);
  term.input("\x03");
  expect(handler).toHaveBeenCalledTimes(1);
  term.dispose();
});

test("keys queued behind Enter are handled between reads", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  const handler = jest.fn();
  term.loadAddon(rl);
  rl.setCtrlCHandler(handler);
  term.write("banner\r\n");
  const read = rl.read("> ");
  // Typed while the prompt is still being printed, so all of it is queued.
  term.input("ls");
  term.input("\r");
  term.input("\x0c");
  term.input("\x03");
  expect(await read).toBe("ls");
  await drain(term);
  expect(viewport(term).every((line) => line === "")).toBe(true);
  expect(handler).toHaveBeenCalledTimes(1);
  term.dispose();
});

test("aborting moves the cursor past the abandoned input", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const read = rl.read("> ", { signal: controller.signal });
  const rejected = expect(read).rejects.toBeDefined();
  await drain(term);
  term.input("hello world");
  term.input("\x01");
  await drain(term);
  controller.abort();
  await rejected;
  rl.println("cancelled");
  await drain(term);
  expect(screen(term, 2)).toEqual(["> hello worldcancelled", ""]);
  term.dispose();
});

test("disposing mid-read does not wedge the addon on its next terminal", async () => {
  const first = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  first.loadAddon(rl);
  const controller = new AbortController();
  const stale = rl.read("> ", { signal: controller.signal });
  const rejected = expect(stale).rejects.toBe("cancelled");
  await drain(first);
  first.dispose();
  const second = new Terminal({ cols: 40, rows: 8 });
  second.loadAddon(rl);
  const next = rl.read("> ");
  await drain(second);
  second.input("ok");
  second.input("\r");
  expect(await next).toBe("ok");
  // The abandoned read still honors its signal.
  controller.abort("cancelled");
  await rejected;
  second.dispose();
});

test("the Ctrl-C handler is not called during a read without a signal", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  const handler = jest.fn();
  term.loadAddon(rl);
  rl.setCtrlCHandler(handler);
  const read = rl.read("> ");
  await drain(term);
  term.input("abc");
  term.input("\x03");
  await drain(term);
  expect(handler).not.toHaveBeenCalled();
  expect(screen(term, 2)).toEqual(["> abc^C", "> "]);
  term.input("\r");
  expect(await read).toBe("");
  term.input("\x03");
  expect(handler).toHaveBeenCalledTimes(1);
  term.dispose();
});

test("during a read with a signal, the Ctrl-C handler runs during and between reads without changing default reset behavior", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  const handler = jest.fn();
  term.loadAddon(rl);
  rl.setCtrlCHandler(handler);

  term.input("\x03");
  expect(handler).toHaveBeenCalledTimes(1);
  handler.mockClear();

  const read = rl.read("> ", { signal: new AbortController().signal });
  const settled = jest.fn();
  void read.then(settled, settled);
  await drain(term);
  term.input("abc");
  term.input("\x03");
  await drain(term);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(settled).not.toHaveBeenCalled();
  expect(rl.getLine()).toBe("");
  expect(screen(term, 2)).toEqual(["> abc^C", "> "]);

  term.input("done");
  term.input("\r");
  expect(await read).toBe("done");
  await drain(term);
  term.input("\x03");
  expect(handler).toHaveBeenCalledTimes(2);
  term.dispose();
});

test("an already-aborted signal rejects without printing or disrupting another read", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const active = rl.read("> ");
  const controller = new AbortController();
  const reason = { cancelled: true };
  controller.abort(reason);
  await expect(rl.read("unused> ", { signal: controller.signal })).rejects.toBe(reason);
  await drain(term);
  expect(screen(term, 1)).toEqual(["> "]);
  term.input("ok");
  term.input("\r");
  expect(await active).toBe("ok");
  term.dispose();
});

test("Ctrl-C can abort an active read without resetting its prompt", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const handler = jest.fn(() => controller.abort());
  rl.setCtrlCHandler(handler);
  const read = rl.read("> ", { signal: controller.signal });
  const rejected = expect(read).rejects.toMatchObject({ name: "AbortError" });
  await drain(term);
  term.input("abc");
  term.input("\x03");
  await rejected;
  await drain(term);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(rl.getLine()).toBe("");
  expect(screen(term, 2)).toEqual(["> abc", ""]);
  expect(History.prototype.saveToLocalStorage).not.toHaveBeenCalled();
  term.dispose();
});

test("Ctrl-C aborts immediately while the prompt is still queued", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const handler = jest.fn(() => controller.abort());
  rl.setCtrlCHandler(handler);
  const read = rl.read("old> ", { signal: controller.signal });
  const rejected = expect(read).rejects.toBeDefined();
  term.input("discarded");
  term.input("\x03");
  expect(handler).toHaveBeenCalledTimes(1);
  await rejected;
  const next = rl.read("new> ");
  term.input("ok");
  await drain(term);
  expect(screen(term, 2)).toEqual(["new> ok", ""]);
  term.input("\r");
  expect(await next).toBe("ok");
  term.dispose();
});

test("abort during prompt output drops queued input and stale callbacks", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const read = rl.read("old> ", { signal: controller.signal });
  const rejected = expect(read).rejects.toBe(null);
  term.input("discarded");
  // Runs after the initial flush callback has queued the prompt output, but
  // before its completion callback initializes editing.
  term.write("", () => controller.abort(null));
  await rejected;
  const next = rl.read("new> ");
  term.input("ok");
  await drain(term);
  expect(screen(term, 1)).toEqual(["old> new> ok"]);
  expect(rl.getLine()).toBe("ok");
  term.input("\r");
  expect(await next).toBe("ok");
  term.dispose();
});

test("completion removes the abort listener and isolates the next read", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const first = rl.read("> ", { signal: controller.signal });
  await drain(term);
  term.input("one");
  term.input("\r");
  expect(await first).toBe("one");
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  const next = rl.read("> ");
  controller.abort();
  await drain(term);
  term.input("two");
  term.input("\r");
  expect(await next).toBe("two");
  term.dispose();
});

test("a non-aborting Ctrl-C handler runs once when the prompt is queued", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  const handler = jest.fn();
  term.loadAddon(rl);
  rl.setCtrlCHandler(handler);
  const read = rl.read("> ", { signal: new AbortController().signal });
  term.input("\x03");
  expect(handler).toHaveBeenCalledTimes(1);
  await drain(term);
  expect(handler).toHaveBeenCalledTimes(1);
  expect(screen(term, 2)).toEqual(["> ^C", "> "]);
  term.input("ok");
  term.input("\r");
  expect(await read).toBe("ok");
  term.dispose();
});

test("a Ctrl-C handler can abort and synchronously start a replacement read", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const read = rl.read("old> ", { signal: controller.signal });
  const rejected = expect(read).rejects.toBeDefined();
  let replacement: Promise<string> | undefined;
  rl.setCtrlCHandler(() => {
    controller.abort();
    replacement = rl.read("new> ");
  });
  term.input("\x03");
  await rejected;
  await drain(term);
  expect(screen(term, 1)).toEqual(["new> "]);
  term.input("ok");
  term.input("\r");
  expect(await replacement).toBe("ok");
  term.dispose();
});

test("abort during Ctrl-L redraw prevents the abandoned prompt from returning", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const read = rl.read("old> ", { signal: controller.signal });
  const rejected = expect(read).rejects.toBeDefined();
  await drain(term);
  term.input("abc");
  term.input("\x0c");
  controller.abort();
  await rejected;
  const next = rl.read("new> ");
  await drain(term);
  expect(screen(term, 2)).toEqual(["new> ", ""]);
  term.input("\r");
  expect(await next).toBe("");
  term.dispose();
});

test("aborting removes its listener and a concurrent read cannot orphan it", async () => {
  const term = new Terminal({ cols: 40, rows: 8 });
  const rl = new Readline();
  term.loadAddon(rl);
  const controller = new AbortController();
  const remove = jest.spyOn(controller.signal, "removeEventListener");
  const first = rl.read("> ", { signal: controller.signal });
  const rejected = expect(first).rejects.toBe("cancelled");
  await expect(rl.read("other> ")).rejects.toThrow("a read is already active");
  controller.abort("cancelled");
  await rejected;
  expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  await drain(term);
  expect(screen(term, 1)).toEqual([""]);
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
  // The first terminal's queued prompt must not leak onto the second.
  expect(screen(second, 2)).toEqual(["^C", "> "]);
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
