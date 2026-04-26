import { Position, Layout } from "./state";
import { LineBuffer } from "./line";
import stringWidth from "string-width";
import { Highlighter } from "./highlight";

export interface Output {
  write(text: string): void;
  print(text: string): void;
  println(text: string): void;
}

export class Tty {
  public tabWidth: number;
  public col: number;
  public row: number;
  public anchorRow: number;
  private out: Output;

  constructor(
    col: number,
    row: number,
    tabWidth: number,
    out: Output,
    anchorRow = 0
  ) {
    this.tabWidth = tabWidth;
    this.col = col;
    this.row = row;
    this.anchorRow = anchorRow;
    this.out = out;
  }

  public write(text: string) {
    return this.out.write(text);
  }

  public print(text: string) {
    return this.out.print(text);
  }

  public println(text: string) {
    return this.out.println(text);
  }

  public clearScreen() {
    this.out.write("\x1b[H\x1b[2J");
  }

  public viewportRows(): number {
    return Math.max(this.row - this.anchorRow, 1);
  }

  // Calculate the number of colums and rows required to print
  // text on a this.cols wide terminal starting at orig
  public calculatePosition(text: string, orig: Position): Position {
    const pos = { ...orig };
    let escSeq = 0;

    [...text].forEach((c) => {
      if (c === "\n") {
        pos.row += 1;
        pos.col = 0;
        return;
      }
      let cw = 0;
      if (c === "\t") {
        cw = this.tabWidth - (pos.col % this.tabWidth);
      } else {
        let size;
        [size, escSeq] = width(c, escSeq);
        cw = size;
      }
      pos.col += cw;
      if (pos.col > this.col) {
        pos.row += 1;
        pos.col = cw;
      }
    });

    if (pos.col === this.col) {
      pos.col = 0;
      pos.row += 1;
    }

    return pos;
  }

  public computeLayout(promptSize: Position, line: LineBuffer): Layout {
    const newPromptSize = { ...promptSize };
    const pos = line.pos;
    const cursor = this.calculatePosition(
      line.buf.slice(0, line.pos),
      promptSize
    );
    const end =
      pos === line.buf.length
        ? { ...cursor }
        : this.calculatePosition(line.buf.slice(pos), cursor);
    const newLayout: Layout = {
      promptSize: newPromptSize,
      cursor,
      end,
      scrollOffset: 0,
    };
    return newLayout;
  }

  // Split highlighted text into visual rows respecting wrap at this.col,
  // re-applying any active SGR escape sequence at the start of each new row.
  public splitIntoVisualRows(text: string): string[] {
    const rows: string[] = [];
    let currentRow = "";
    let col = 0;
    let escSeq = 0;
    let activeSgr = "";
    let pendingEsc = "";

    const finishEsc = () => {
      if (pendingEsc.endsWith("m")) {
        if (
          pendingEsc === "\x1b[0m" ||
          pendingEsc === "\x1b[m" ||
          /^\x1b\[0(?:;0)*m$/.test(pendingEsc)
        ) {
          activeSgr = "";
        } else {
          activeSgr = pendingEsc;
        }
      }
      pendingEsc = "";
    };

    for (const c of [...text]) {
      // Inside an active escape sequence: append to row, track terminator.
      if (escSeq !== 0) {
        currentRow += c;
        pendingEsc += c;
        const [, next] = width(c, escSeq);
        escSeq = next;
        if (escSeq === 0) finishEsc();
        continue;
      }

      if (c === "\x1b") {
        currentRow += c;
        pendingEsc = c;
        const [, next] = width(c, 0);
        escSeq = next;
        if (escSeq === 0) finishEsc();
        continue;
      }

      if (c === "\n") {
        rows.push(currentRow);
        currentRow = activeSgr;
        col = 0;
        continue;
      }

      let cw = 0;
      if (c === "\t") {
        cw = this.tabWidth - (col % this.tabWidth);
      } else {
        cw = stringWidth(c);
      }

      if (col + cw > this.col) {
        rows.push(currentRow);
        currentRow = activeSgr + c;
        col = cw;
      } else {
        currentRow += c;
        col += cw;
      }
    }

    rows.push(currentRow);
    // If the buffer ends exactly at the right margin, calculatePosition
    // normalizes the end to (row+1, 0). Mirror that here so the row count
    // matches Layout.end.row — otherwise cursor positioning lands one row
    // short and any subsequent incremental moves drift.
    if (col === this.col && col > 0) {
      rows.push(activeSgr);
    }
    return rows;
  }

  // Render the layout in a window of viewportRows() rows starting at anchorRow.
  // Only rows in [scrollOffset, scrollOffset + viewportRows) are emitted.
  public refreshLine(
    prompt: string,
    line: LineBuffer,
    oldLayout: Layout,
    newLayout: Layout,
    highlighter: Highlighter
  ) {
    // Hide the cursor for the duration of the refresh sequence. The
    // intermediate cursor-up / row-rewrite / cursor-down steps below
    // would otherwise render the cursor briefly at the buffer's anchor
    // row on every redraw, which appears as a phantom flash on the
    // line above when the buffer spans multiple lines.
    this.write("\x1b[?25l");
    try {
      this.refreshLineInner(prompt, line, oldLayout, newLayout, highlighter);
    } finally {
      this.write("\x1b[?25h");
    }
  }

  private refreshLineInner(
    prompt: string,
    line: LineBuffer,
    oldLayout: Layout,
    newLayout: Layout,
    highlighter: Highlighter
  ) {
    const oldScroll = oldLayout.scrollOffset ?? 0;
    const newScroll = newLayout.scrollOffset ?? 0;

    // Step 0: build the full highlighted text and split into visual rows so we
    // know the buffer height before deciding whether to scroll the terminal.
    const highlighted =
      highlighter.highlightPrompt(prompt) +
      highlighter.highlight(line.buf, line.pos);
    const allRows = this.splitIntoVisualRows(highlighted);

    // Step 1: where is the physical cursor right now? After the previous
    // refresh it ended at (anchor + oldCursorViewportRow, oldCursor.col).
    const oldCursorViewportRow = Math.max(oldLayout.cursor.row - oldScroll, 0);
    let physicalRow = this.anchorRow + oldCursorViewportRow;

    // Step 2: if the buffer needs more rows than fit below the anchor, scroll
    // the terminal up by writing \n at the last row. This pulls anchorRow
    // toward 0 (and lets the prompt scroll into scrollback for very tall
    // buffers, matching bash's behavior on history recall of a tall command).
    const desiredVisible = Math.min(allRows.length, this.row);
    const currentBelowAnchor = this.row - this.anchorRow;
    if (desiredVisible > currentBelowAnchor && this.anchorRow > 0) {
      const scrollUp = Math.min(
        desiredVisible - currentBelowAnchor,
        this.anchorRow
      );
      const downBy = this.row - 1 - physicalRow;
      if (downBy > 0) this.write(`\x1b[${downBy}B`);
      this.write("\n".repeat(scrollUp));
      this.anchorRow -= scrollUp;
      physicalRow = this.row - 1;
    }

    // Step 3: move physical cursor up to anchorRow.
    const upToAnchor = physicalRow - this.anchorRow;
    if (upToAnchor > 0) this.write(`\x1b[${upToAnchor}A`);

    // Step 4: move to col 0 and erase from cursor down.
    this.write("\r\x1b[J");

    // Step 5: re-clamp scrollOffset against the (possibly enlarged) viewport.
    // State computed scrollOffset with the pre-scroll viewport; if the
    // anchor just dropped, the buffer may now fit and scrollOffset can
    // collapse back to 0.
    const viewport = this.viewportRows();
    let effectiveScroll = newScroll;
    if (newLayout.cursor.row < effectiveScroll) {
      effectiveScroll = newLayout.cursor.row;
    } else if (newLayout.cursor.row >= effectiveScroll + viewport) {
      effectiveScroll = newLayout.cursor.row - viewport + 1;
    }
    if (allRows.length <= viewport) effectiveScroll = 0;
    effectiveScroll = Math.max(
      0,
      Math.min(effectiveScroll, allRows.length - viewport)
    );
    newLayout.scrollOffset = effectiveScroll;
    const start = effectiveScroll;
    const end = Math.min(allRows.length, start + viewport);

    // Step 4: emit visible rows joined by \r\n. Reset SGR between rows so
    // styles do not leak when the next row starts without an SGR.
    for (let i = start; i < end; i++) {
      if (i > start) this.write("\r\n");
      this.write(allRows[i]);
      // Reset any active style at end-of-row to avoid bleeding into prompt
      // re-renders or the gap below the buffer.
      this.write("\x1b[0m");
    }

    // Step 6: position cursor at (newCursor.row - effectiveScroll, newCursor.col).
    const cursorViewportRow = newLayout.cursor.row - effectiveScroll;
    const lastWrittenViewportRow = end - 1 - start;
    const upBy = Math.max(lastWrittenViewportRow - cursorViewportRow, 0);
    if (upBy > 0) this.write(`\x1b[${upBy}A`);
    if (newLayout.cursor.col > 0) {
      this.write(`\r\x1b[${newLayout.cursor.col}C`);
    } else {
      this.write("\r");
    }
  }

  public moveCursor(oldCursor: Position, newCursor: Position) {
    if (newCursor.row > oldCursor.row) {
      // Move Down
      const rowShift = newCursor.row - oldCursor.row;
      if (rowShift === 1) {
        this.write("\x1b[B");
      } else {
        this.write(`\x1b[${rowShift}B`);
      }
    } else if (newCursor.row < oldCursor.row) {
      // Move Up
      const rowShift = oldCursor.row - newCursor.row;
      if (rowShift === 1) {
        this.write("\x1b[A");
      } else {
        this.write(`\x1b[${rowShift}A`);
      }
    }

    if (newCursor.col > oldCursor.col) {
      // Move Right
      const colShift = newCursor.col - oldCursor.col;
      if (colShift === 1) {
        this.write("\x1b[C");
      } else {
        this.write(`\x1b[${colShift}C`);
      }
    } else if (newCursor.col < oldCursor.col) {
      const colShift = oldCursor.col - newCursor.col;
      if (colShift === 1) {
        this.write("\x1b[D");
      } else {
        this.write(`\x1b[${colShift}D`);
      }
    }
    return;
  }
}

// Return the column width of text when printed
function width(text: string, escSeq: number): [size: number, esc_seq: number] {
  if (escSeq === 1) {
    if (text === "[") {
      return [0, 2];
    } else {
      return [0, 0];
    }
  } else if (escSeq === 2) {
    if (!(text === ";" || (text[0] >= "0" && text[0] <= "9"))) {
      // unsupported
      return [0, 0];
    }
    return [0, escSeq];
  } else if (text === "\x1b") {
    return [0, 1];
  } else if (text === "\n") {
    return [0, escSeq];
  } else {
    return [stringWidth(text), escSeq];
  }
}
