import { Terminal, ITerminalAddon, IDisposable, IMarker } from "@xterm/xterm";
import { Input, InputType, parseInput } from "./keymap";
import { State } from "./state";
import { History } from "./history";
import { Output, Tty } from "./tty";
import { Highlighter, IdentityHighlighter } from "./highlight";

interface ActiveRead {
  prompt: string;
  resolve: (input: string) => void;
  reject: (e: unknown) => void;
  signal?: AbortSignal;
  cleanup?: () => void;
}

export interface ReadOptions {
  signal?: AbortSignal;
}

type CheckHandler = (text: string) => boolean;
type CtrlCHandler = () => void;
type PauseHandler = (resume: boolean) => void;

export class Readline implements ITerminalAddon {
  private term: Terminal | undefined;
  private highlighter: Highlighter = new IdentityHighlighter();
  private history: History = new History(50);
  private activeRead: ActiveRead | undefined;
  private printingPrompt = false;
  private pendingKeys: Input[] = [];
  private promptGeneration = 0;
  private promptMarker: IMarker | undefined;
  private promptStartCol = 0;
  private promptRows = 0;
  private resizePending = false;
  private disposables: IDisposable[] = [];
  private watermark = 0;
  private highWatermark = 10000;
  private lowWatermark = 1000;
  private highWater = false;
  private state: State = new State(
    ">",
    this.tty(),
    this.highlighter,
    this.history
  );
  private checkHandler: CheckHandler = () => true;
  private ctrlCHandler: CtrlCHandler = () => {
    return;
  };

  private pauseHandler: PauseHandler = (resume: boolean) => {
    return;
  };

  constructor() {
    this.history.restoreFromLocalStorage();
  }

  /**
   * Activate this addon - this function is called by xterm's
   * loadAddon().
   *
   * @param term - The terminal this readline is attached to.
   */
  public activate(term: Terminal): void {
    this.term = term;
    // A prompt print in flight on a previous terminal never finishes for this
    // one; drop its bookkeeping so input is not queued forever.
    this.resetPrompt();
    this.disposables.push(this.term.onData(this.readData.bind(this)));
    this.disposables.push(
      this.term.onResize(({ cols, rows }) => {
        const tty = this.state.getTty();
        tty.col = cols;
        tty.row = rows;
        if (tty.anchorRow >= rows) tty.anchorRow = Math.max(0, rows - 1);
        if (this.activeRead !== undefined) {
          if (this.printingPrompt) {
            this.resizePending = true;
          } else {
            this.redrawPrompt();
          }
        }
      })
    );
    this.term.attachCustomKeyEventHandler(this.handleKeyEvent.bind(this));
  }

  /**
   * Dispose. A readline belongs to one terminal at a time; dispose it with
   * that terminal.
   *
   */
  public dispose(): void {
    // Release a pending read so a re-activated addon can read again. Its
    // promise stays pending, but its signal can still reject it.
    this.activeRead = undefined;
    this.resetPrompt();
    this.term = undefined;
    this.disposables.forEach((d) => d.dispose());
  }

  /**
   * Manually append a line to the top of the readline's history.
   *
   * @param text - The text to append to history.
   */
  public appendHistory(text: string) {
    this.history.append(text);
  }

  /**
   * Set the highlighter handler for this readline. This is used to
   * create custom highlighting functionality (e.g. for syntax highlighting
   * or bracket matching).
   *
   * @param highlighter - A handler to handle all highlight callbacks.
   */
  public setHighlighter(highlighter: Highlighter) {
    this.highlighter = highlighter;
  }

  /**
   * Set the check callback. This callback is used by readline to determine if input
   * requires additiona lines when the user presses 'enter'.
   *
   * @param fn - A function (string) -> boolean that should return true if the input
   *             is complete, and false if a line (\n) should be added to the input.
   */
  public setCheckHandler(fn: CheckHandler) {
    this.checkHandler = fn;
  }

  /**
   * Set the ctrl-c handler. This function will be called if ctrl-c is encountered
   * between readline reads. This may be used in circumstances where input from the
   * user may result in a long running task that can be cancelled.
   *
   * It is also called during reads that were given a `signal`, before the
   * input is cleared and the prompt reprinted. Aborting that signal from the
   * handler cancels the read instead.
   *
   * @param fn - The ctrl-c handler.
   */
  public setCtrlCHandler(fn: CtrlCHandler) {
    this.ctrlCHandler = fn;
  }

  /**
   * Set the callback to be called when the user presses ctrl-s/ctrl-q.
   *
   * @param fn - The pause handler
   */
  public setPauseHandler(fn: PauseHandler) {
    this.pauseHandler = fn;
  }

  /**
   * writeReady() may be used to implement basic output flow control. This function
   * will return false if the writes to the terminal initiated by Readline have
   * reached a highwater mark.
   *
   * @returns true if this terminal is accepting more input.
   */
  public writeReady(): boolean {
    return !this.highWater;
  }

  /**
   * Write text to the terminal.
   *
   * @param text - The text to write to the terminal.
   */
  public write(text: string) {
    if (text === "\n") {
      text = "\r\n";
    } else {
      text = text.replace(/^\n/, "\r\n");
      text = text.replace(/([^\r])\n/g, "$1\r\n");
    }
    const outputLength = text.length;
    this.watermark += outputLength;
    if (this.watermark > this.highWatermark) {
      this.highWater = true;
    }
    if (this.term) {
      this.term.write(text, () => {
        this.watermark = Math.max(this.watermark - outputLength, 0);
        if (this.highWater && this.watermark < this.lowWatermark) {
          this.highWater = false;
        }
      });
    }
  }

  /**
   * Write text to the terminal.
   *
   * @param text - The text to write to the terminal
   */
  public print(text: string) {
    return this.write(text);
  }

  /**
   * Write text to the terminal and append with "\r\n".
   *
   * @param text - The text to write to the terminal./
   * @returns
   */
  public println(text: string) {
    return this.write(text + "\r\n");
  }

  /**
   * Get the current line.
   *
   * @returns string - The current line
   */
  public getLine() {
    return this.state.buffer();
  }

  /**
   * Update the current line.
   *
   * @param text - The text to write to the terminal./
   * @returns
   */
  public updateLine(text: string) {
    return this.state.update(text);
  }

  /**
   * Obtain an output interface to this terminal.
   *
   * @returns Output
   */
  public output(): Output {
    return this;
  }

  /**
   * Obtain a tty interface to this terminal.
   *
   * @returns A tty
   */
  public tty(): Tty {
    if (this.term?.options?.tabStopWidth !== undefined) {
      const anchor = this.term.buffer.active.cursorY;
      return new Tty(
        this.term.cols,
        this.term.rows,
        this.term.options.tabStopWidth,
        this.output(),
        anchor,
        this.term.buffer.active.cursorX
      );
    } else {
      return new Tty(0, 0, 8, this.output());
    }
  }

  /**
   * Display the given prompt and wait for one line of input from the
   * terminal. The returned promise will be executed when a line has been
   * read from the terminal.
   *
   * @param prompt The prompt to use.
   * @param options An optional signal; aborting rejects with signal.reason.
   * @returns A promise to be called when the input has been read.
   */
  public read(prompt: string, options: ReadOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      if (this.term === undefined) {
        reject("addon is not active");
        return;
      }
      if (this.activeRead !== undefined) {
        reject(new Error("a read is already active"));
        return;
      }
      const read: ActiveRead = { prompt, resolve, reject, signal };
      this.activeRead = read;
      if (signal !== undefined) {
        const abort = () => this.abortRead(read, signal.reason);
        read.cleanup = () => signal.removeEventListener("abort", abort);
        signal.addEventListener("abort", abort, { once: true });
      }
      this.printPrompt(prompt, (tty) => {
        this.state = new State(
          prompt,
          tty,
          this.highlighter,
          this.history,
          () => this.redrawPrompt()
        );
        this.state.refresh();
      });
    });
  }

  private abortRead(read: ActiveRead, reason: unknown) {
    if (this.activeRead === read) {
      // While a prompt is printing, the editing state isn't on screen yet.
      if (!this.printingPrompt) {
        // Leave the cursor after the abandoned input, as Enter does.
        this.state.moveCursorToEnd();
        this.state.refreshUnhighlighted();
      }
      // Forget abandoned input without erasing output or printing another prompt.
      this.state = new State("", this.tty(), this.highlighter, this.history);
    }
    this.finishRead(read, () => read.reject(reason));
  }

  // A read released by dispose() is no longer active, but still settles.
  private finishRead(read: ActiveRead, settle: () => void) {
    read.cleanup?.();
    if (this.activeRead === read) {
      this.activeRead = undefined;
      this.resetPrompt();
    }
    settle();
  }

  // Invalidate prompt output still in flight and drop input queued behind it.
  private resetPrompt() {
    this.promptGeneration++;
    this.printingPrompt = false;
    this.pendingKeys = [];
    this.resizePending = false;
    this.promptMarker?.dispose();
    this.promptMarker = undefined;
  }

  // Let xterm lay out the prompt, then anchor the editable input at its end.
  // The prompt itself is no longer part of input redraws.
  private printPrompt(prompt: string, done: (tty: Tty) => void) {
    const term = this.term;
    if (term === undefined) return;
    // Re-activation, a newer prompt, and the end of the read all bump this.
    const generation = ++this.promptGeneration;
    const isCurrent = () => this.promptGeneration === generation;
    this.printingPrompt = true;
    let startRow = 0;
    const finish = () => {
      if (!isCurrent()) return;
      const buffer = term.buffer.active;
      this.promptRows = (buffer.baseY ?? 0) + buffer.cursorY - startRow;
      done(this.tty());
      if (!isCurrent()) return;
      this.printingPrompt = false;
      if (this.resizePending) {
        this.resizePending = false;
        this.redrawPrompt();
        return;
      }
      const pending = this.pendingKeys;
      this.pendingKeys = [];
      // Keys typed after an Enter are handled between reads. During a read
      // with a signal, Ctrl-C was already reported when it arrived.
      const reported = this.activeRead?.signal !== undefined;
      for (const key of pending) this.readKey(key, !reported);
    };
    const emit = () => {
      if (!isCurrent()) return;
      const buffer = term.buffer.active;
      startRow = (buffer.baseY ?? 0) + buffer.cursorY;
      this.promptStartCol = buffer.cursorX;
      this.promptMarker?.dispose();
      this.promptMarker = term.registerMarker?.(0);
      const highlighted = this.highlighter.highlightPrompt(prompt);
      if (!isCurrent()) return;
      this.write("\x1b[J" + highlighted + "\x1b[0m");
      term.write("", () => {
        if (!isCurrent()) return;
        // Normalize xterm's pending wrap before sampling the input anchor.
        if (term.buffer.active.cursorX >= term.cols) {
          term.write("\r\n", finish);
        } else {
          finish();
        }
      });
    };
    term.write("", () => {
      if (!isCurrent()) return;
      if (term.buffer.active.cursorX >= term.cols) {
        term.write("\r\n", emit);
      } else {
        emit();
      }
    });
  }

  // Returns false when there is no active read to redraw a prompt for.
  private redrawPrompt(): boolean {
    if (this.term === undefined || this.activeRead === undefined) return false;
    const tty = this.state.getTty();
    const marker = this.promptMarker;
    const row =
      marker !== undefined && !marker.isDisposed
        ? marker.line - (this.term.buffer.active.baseY ?? 0)
        : tty.anchorRow - this.promptRows;
    const startRow = Math.max(0, Math.min(this.term.rows - 1, row));
    const startCol = Math.min(this.promptStartCol, this.term.cols - 1);
    this.term.write(`\x1b[${startRow + 1};${startCol + 1}H`);
    this.printPrompt(this.activeRead.prompt, (nextTty) =>
      this.state.reanchor(nextTty)
    );
    return true;
  }

  private handleKeyEvent(event: KeyboardEvent): boolean {
    if (event.key === "Enter" && event.shiftKey) {
      if (event.type === "keydown") {
        this.readKey({
          inputType: InputType.ShiftEnter,
          data: ["\r"],
        });
      }
      return false;
    }
    return true;
  }

  private readData(data: string) {
    const input = parseInput(data);
    if (
      input.length > 1 ||
      (input[0].inputType === InputType.Text && input[0].data.length > 1)
    ) {
      this.readPaste(input);
      return;
    }
    this.readKey(input[0]);
  }

  private readPaste(input: Input[]) {
    const mappedInput = input.map((it) => {
      if (it.inputType === InputType.Enter) {
        return { inputType: InputType.Text, data: ["\n"] };
      }
      return it;
    });

    for (const it of mappedInput) {
      this.readKey(it);
    }
  }

  private readKey(input: Input, notifyCtrlC = true) {
    if (
      input.inputType === InputType.CtrlC &&
      notifyCtrlC &&
      this.activeRead?.signal !== undefined
    ) {
      const read = this.activeRead;
      try {
        this.ctrlCHandler();
      } finally {
        // Unless the handler aborted the read (and possibly started a
        // replacement), reset it as usual.
        if (this.activeRead === read) this.readKey(input, false);
      }
      return;
    }
    if (this.printingPrompt) {
      this.pendingKeys.push(input);
      return;
    }
    if (this.activeRead === undefined) {
      switch (input.inputType) {
        case InputType.CtrlC:
          if (notifyCtrlC) this.ctrlCHandler();
          break;
        case InputType.CtrlL:
          this.write("\x1b[H\x1b[2J");
          break;
      }
      return;
    }

    switch (input.inputType) {
      case InputType.Text:
        this.state.editInsert(input.data.join(""));
        break;
      case InputType.AltEnter:
      case InputType.ShiftEnter:
        this.state.editInsert("\n");
        break;
      case InputType.Enter:
        if (this.checkHandler(this.state.buffer())) {
          this.state.moveCursorToEnd();
          // Strip any cursor-driven highlight (e.g. matching brackets)
          // before committing so the line frozen in scrollback is plain.
          this.state.refreshUnhighlighted();
          this.term?.write("\r\n");
          this.history.append(this.state.buffer());
          const read = this.activeRead;
          this.finishRead(read, () => read.resolve(this.state.buffer()));
        } else {
          this.state.editInsert("\n");
        }
        break;
      case InputType.CtrlC: {
        this.state.moveCursorToEnd();
        this.term?.write("^C\r\n");
        const prompt = this.activeRead.prompt;
        this.printPrompt(prompt, (tty) => {
          this.state = new State(
            prompt,
            tty,
            this.highlighter,
            this.history,
            () => this.redrawPrompt()
          );
          this.state.refresh();
        });
        break;
      }
      case InputType.CtrlS:
        this.pauseHandler(false);
        break;
      case InputType.CtrlU:
        this.state.update("");
        break;
      case InputType.CtrlK:
        this.state.editDeleteEndOfLine();
        break;
      case InputType.CtrlQ:
        this.pauseHandler(true);
        break;
      case InputType.CtrlL:
        this.term?.write("\x1b[H\x1b[2J");
        this.printPrompt(this.activeRead.prompt, (tty) => this.state.reanchor(tty));
        break;
      case InputType.Home:
      case InputType.CtrlA:
        this.state.moveCursorHome();
        break;
      case InputType.End:
      case InputType.CtrlE:
        this.state.moveCursorEnd();
        break;
      case InputType.Backspace:
        this.state.editBackspace(1);
        break;
      case InputType.Delete:
      case InputType.CtrlD:
        this.state.editDelete(1);
        break;
      case InputType.ArrowLeft:
        this.state.moveCursorBack(1);
        break;
      case InputType.ArrowRight:
        this.state.moveCursorForward(1);
        break;
      case InputType.ArrowUp:
        this.state.moveCursorUp(1);
        break;
      case InputType.ArrowDown:
        this.state.moveCursorDown(1);
        break;
      case InputType.UnsupportedControlChar:
      case InputType.UnsupportedEscape:
        break;
    }
  }
}
