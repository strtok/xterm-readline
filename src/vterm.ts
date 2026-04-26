// Virtual terminal harness for tests. Implements the Output interface, parses
// the ANSI escape sequences emitted by xterm-readline (CUU/CUD/CUF/CUB, CUP,
// ED, EL, SGR), and maintains a 2D grid + cursor + scrollback. Tests assert on
// the resulting visible screen rather than the exact byte stream, so they
// survive renderer refactors as long as the user-visible result is correct.

import { Output } from "./tty";

export class VTerm implements Output {
  public cols: number;
  public rows: number;
  public cursorRow = 0;
  public cursorCol = 0;
  public grid: string[][];
  public scrollback: string[][] = [];
  // xterm-style "pending wrap": when a character is written into the last
  // column the cursor stays at that column with this flag set; the next
  // printable char wraps to the next row before being written. \r, \n, and
  // any cursor-positioning command clear the flag.
  private pendingWrap = false;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.grid = Array.from({ length: rows }, () => this.blankRow());
  }

  public write(text: string): void {
    let i = 0;
    while (i < text.length) {
      const c = text[i];
      if (c === "\x1b") {
        if (text[i + 1] === "[") {
          let j = i + 2;
          let params = "";
          while (j < text.length && /[0-9;]/.test(text[j])) {
            params += text[j];
            j++;
          }
          const final = text[j];
          if (final !== undefined) this.handleCSI(params, final);
          i = j + 1;
        } else {
          // Unknown escape — skip the ESC.
          i += 1;
        }
        continue;
      }
      if (c === "\n") {
        this.lineFeed();
        i++;
        continue;
      }
      if (c === "\r") {
        this.cursorCol = 0;
        this.pendingWrap = false;
        i++;
        continue;
      }
      this.putChar(c);
      i++;
    }
  }

  public print(text: string): void {
    this.write(text);
  }

  public println(text: string): void {
    this.write(text + "\r\n");
  }

  // Return the visible grid as a string, rows joined by '\n', trailing
  // whitespace trimmed per row and trailing blank rows dropped so assertions
  // stay readable. Use `grid` directly if you need the full padded matrix.
  public screen(): string {
    const trimmed = this.grid.map((r) => r.join("").replace(/ +$/, ""));
    while (trimmed.length > 0 && trimmed[trimmed.length - 1] === "") {
      trimmed.pop();
    }
    return trimmed.join("\n");
  }

  public cursor(): [number, number] {
    return [this.cursorRow, this.cursorCol];
  }

  // Mirror xterm.js's resize behavior: clamp cursor into the new bounds and
  // grow/shrink the grid (existing rows preserved at the top).
  public resize(cols: number, rows: number): void {
    if (rows < this.grid.length) {
      this.grid = this.grid.slice(0, rows);
    } else {
      while (this.grid.length < rows) this.grid.push(this.blankRow());
    }
    if (cols !== this.cols) {
      this.grid = this.grid.map((r) => {
        if (cols < r.length) return r.slice(0, cols);
        return [...r, ...Array.from({ length: cols - r.length }, () => " ")];
      });
    }
    this.cols = cols;
    this.rows = rows;
    this.cursorRow = Math.max(0, Math.min(rows - 1, this.cursorRow));
    this.cursorCol = Math.max(0, Math.min(cols - 1, this.cursorCol));
    this.pendingWrap = false;
  }

  private blankRow(): string[] {
    return Array.from({ length: this.cols }, () => " ");
  }

  private putChar(c: string): void {
    if (this.pendingWrap) {
      this.cursorCol = 0;
      this.lineFeed();
      this.pendingWrap = false;
    }
    this.grid[this.cursorRow][this.cursorCol] = c;
    if (this.cursorCol === this.cols - 1) {
      this.pendingWrap = true;
    } else {
      this.cursorCol++;
    }
  }

  private lineFeed(): void {
    if (this.cursorRow < this.rows - 1) {
      this.cursorRow++;
    } else {
      this.scrollback.push(this.grid.shift()!);
      this.grid.push(this.blankRow());
    }
    this.pendingWrap = false;
  }

  private handleCSI(params: string, final: string): void {
    const args = params.length === 0 ? [] : params.split(";").map((p) => parseInt(p, 10) || 0);
    const arg = (i: number, def: number) =>
      args[i] === undefined ? def : args[i] || def;
    switch (final) {
      case "A":
        this.cursorRow = Math.max(0, this.cursorRow - arg(0, 1));
        this.pendingWrap = false;
        return;
      case "B":
        this.cursorRow = Math.min(this.rows - 1, this.cursorRow + arg(0, 1));
        this.pendingWrap = false;
        return;
      case "C":
        this.cursorCol = Math.min(this.cols - 1, this.cursorCol + arg(0, 1));
        this.pendingWrap = false;
        return;
      case "D":
        this.cursorCol = Math.max(0, this.cursorCol - arg(0, 1));
        this.pendingWrap = false;
        return;
      case "H": {
        const r = arg(0, 1) - 1;
        const c = arg(1, 1) - 1;
        this.cursorRow = Math.max(0, Math.min(this.rows - 1, r));
        this.cursorCol = Math.max(0, Math.min(this.cols - 1, c));
        this.pendingWrap = false;
        return;
      }
      case "J": {
        const mode = args[0] || 0;
        if (mode === 0) {
          for (let c = this.cursorCol; c < this.cols; c++) {
            this.grid[this.cursorRow][c] = " ";
          }
          for (let r = this.cursorRow + 1; r < this.rows; r++) {
            this.grid[r] = this.blankRow();
          }
        } else if (mode === 2) {
          for (let r = 0; r < this.rows; r++) this.grid[r] = this.blankRow();
        }
        return;
      }
      case "K": {
        const mode = args[0] || 0;
        if (mode === 0) {
          for (let c = this.cursorCol; c < this.cols; c++) {
            this.grid[this.cursorRow][c] = " ";
          }
        }
        return;
      }
      case "m":
        // SGR — ignore styling, we only test visible characters.
        return;
      default:
        return;
    }
  }
}
