/* tslint:disable:max-classes-per-file */
import { LineBuffer } from "./line";
import { Tty } from "./tty";
import { History } from "./history";
import stringWidth from "string-width";
import { Highlighter, IdentityHighlighter } from "./highlight";

export class Position {
  public col: number;
  public row: number;

  constructor(rows?: number, cols?: number) {
    if (rows !== undefined) {
      this.row = rows;
    } else {
      this.row = 0;
    }
    if (cols !== undefined) {
      this.col = cols;
    } else {
      this.col = 0;
    }
  }
}

export class Layout {
  public promptSize: Position;
  public cursor: Position;
  public end: Position;
  public scrollOffset: number;

  constructor(promptSize: Position) {
    this.promptSize = promptSize;
    this.cursor = new Position();
    this.end = new Position();
    this.scrollOffset = 0;
  }
}

export class State {
  private prompt: string;
  private promptSize: Position;
  private line: LineBuffer = new LineBuffer();
  private tty: Tty;
  private layout: Layout;
  private highlighter: Highlighter;
  private highlighting = false;
  private history: History;
  // Bash-style edit-mode lockout: any successful cursor movement or edit
  // sets editing=true; a buffer replacement via update() (history nav or
  // Ctrl-U) resets it. Up/Down only navigate history while editing=false;
  // once editing, Up/Down move within the buffer and no-op at boundaries.
  private editing = false;

  constructor(
    prompt: string,
    tty: Tty,
    highlighter: Highlighter,
    history: History
  ) {
    this.prompt = prompt;
    this.tty = tty;
    this.highlighter = highlighter;
    this.history = history;
    this.promptSize = tty.calculatePosition(prompt, new Position());
    this.layout = new Layout(this.promptSize);
  }

  public buffer(): string {
    return this.line.buffer();
  }

  public getTty(): Tty {
    return this.tty;
  }

  public shouldHighlight(): boolean {
    const highlighting = this.highlighter.highlightChar(
      this.line.buf,
      this.line.pos
    );
    if (highlighting) {
      this.highlighting = true;
      return true;
    } else if (this.highlighting) {
      this.highlighting = false;
      return true;
    } else {
      return false;
    }
  }

  public clearScreen() {
    this.tty.clearScreen();
    this.tty.anchorRow = 0;
    this.layout.cursor = new Position();
    this.layout.end = new Position();
    this.layout.scrollOffset = 0;
    this.refresh();
  }

  public editInsert(text: string) {
    this.editing = true;
    const push = this.line.insert(text);
    const multiline = text.includes("\n");
    if (push && !multiline) {
      const width = stringWidth(text);
      if (
        width > 0 &&
        this.layout.cursor.col + width < this.tty.col &&
        !this.shouldHighlight()
      ) {
        this.layout.cursor.col += width;
        this.layout.end.col += width;
        this.tty.write(text);
      } else {
        this.refresh();
      }
    } else {
      this.refresh();
    }
  }

  public update(text: string) {
    this.line.update(text, text.length);
    this.editing = false;
    this.refresh();
  }

  public editBackspace(n: number) {
    if (this.line.backspace(n)) {
      this.editing = true;
      this.refresh();
    }
  }

  public editDelete(n: number) {
    if (this.line.delete(n)) {
      this.editing = true;
      this.refresh();
    }
  }

  public editDeleteEndOfLine() {
    if (this.line.deleteEndOfLine()) {
      this.editing = true;
      this.refresh();
    }
  }

  public refresh() {
    const newLayout = this.tty.computeLayout(this.promptSize, this.line);
    newLayout.scrollOffset = this.adjustScroll(
      newLayout.cursor.row,
      this.layout.scrollOffset
    );
    this.tty.refreshLine(
      this.prompt,
      this.line,
      this.layout,
      newLayout,
      this.highlighter
    );
    this.layout = newLayout;
  }

  // Re-render the current line with no highlighter applied. Intended
  // for commit-time redraws (e.g. on Enter) so the line that ends up
  // in scrollback doesn't have any cursor-driven highlight (e.g. a
  // matching-bracket SGR) baked into it.
  public refreshUnhighlighted() {
    const prev = this.highlighter;
    this.highlighter = new IdentityHighlighter();
    try {
      this.refresh();
    } finally {
      this.highlighter = prev;
    }
  }

  private adjustScroll(cursorRow: number, prevOffset: number): number {
    const viewport = this.tty.viewportRows();
    if (cursorRow < prevOffset) {
      return cursorRow;
    }
    if (cursorRow >= prevOffset + viewport) {
      return cursorRow - viewport + 1;
    }
    return prevOffset;
  }

  public moveCursorBack(n: number) {
    if (this.line.moveBack(n)) {
      this.editing = true;
      this.moveCursor();
    }
  }

  public moveCursorForward(n: number) {
    if (this.line.moveForward(n)) {
      this.editing = true;
      this.moveCursor();
    }
  }

  public moveCursorUp(n: number) {
    if (this.editing) {
      if (this.line.moveLineUp(n, this.promptSize.col)) {
        this.moveCursor();
      }
      return;
    }
    this.previousHistory();
  }

  public moveCursorDown(n: number) {
    if (this.editing) {
      if (this.line.moveLineDown(n, this.promptSize.col)) {
        this.moveCursor();
      }
      return;
    }
    this.nextHistory();
  }

  public moveCursorHome() {
    if (this.line.moveHome()) {
      this.editing = true;
      this.moveCursor();
    }
  }

  public moveCursorEnd() {
    if (this.line.moveEnd()) {
      this.editing = true;
      this.moveCursor();
    }
  }

  public moveCursorToEnd() {
    if (this.line.pos === this.line.buf.length) {
      return;
    }
    this.line.pos = this.line.buf.length;
    this.refresh();
  }

  public previousHistory() {
    if (this.history.cursor === -1 && this.line.length() > 0) {
      return;
    }
    const prev = this.history.prev();
    if (prev !== undefined) {
      this.update(prev);
    }
  }

  public nextHistory() {
    if (this.history.cursor === -1) {
      return;
    }
    const next = this.history.next();
    if (next !== undefined) {
      this.update(next);
    } else {
      this.update("");
    }
  }

  public moveCursor() {
    const cursor = this.tty.calculatePosition(
      this.line.pos_buffer(),
      this.promptSize
    );
    if (cursor === this.layout.cursor) {
      return;
    }
    const viewport = this.tty.viewportRows();
    const inWindow =
      cursor.row >= this.layout.scrollOffset &&
      cursor.row < this.layout.scrollOffset + viewport;
    if (this.shouldHighlight() || !inWindow) {
      this.refresh();
    } else {
      this.tty.moveCursor(this.layout.cursor, cursor);
      this.layout.promptSize = { ...this.promptSize };
      this.layout.cursor = { ...cursor };
    }
  }
}
