import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { FitAddon } from "@xterm/addon-fit";
import { Readline } from "../src/readline";
import type { Highlighter } from "../src/highlight";

const params = new URLSearchParams(window.location.search);
const forcedCols = params.has("cols") ? Number(params.get("cols")) : undefined;
const forcedRows = params.has("rows") ? Number(params.get("rows")) : undefined;

const term = new Terminal({
  theme: { background: "#191A19", foreground: "#F5F2E7" },
  fontFamily: "Menlo, Consolas, monospace",
  fontSize: 14,
  cursorBlink: true,
  cursorStyle: "block",
  allowProposedApi: true,
  ...(forcedCols !== undefined ? { cols: forcedCols } : {}),
  ...(forcedRows !== undefined ? { rows: forcedRows } : {}),
});

const rl = new Readline();
term.loadAddon(rl);

const container = document.getElementById("terminal")!;
if (forcedRows !== undefined) {
  // Don't let the 100vh container expand the rendered terminal past the
  // requested rows — xterm.js fits its renderer to container size and
  // would otherwise grow the row count back up.
  container.style.height = "auto";
  container.style.display = "inline-block";
}

term.open(container);

if (forcedCols === undefined && forcedRows === undefined) {
  const fit = new FitAddon();
  term.loadAddon(fit);
  fit.fit();
  window.addEventListener("resize", () => fit.fit());
}

term.focus();

// Submit only when ()/[]/{} are balanced. Until then, Enter inserts \n.
function balanced(input: string): boolean {
  const pairs: Record<string, string> = { ")": "(", "]": "[", "}": "{" };
  const stack: string[] = [];
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (inString) {
      if (c === "\\") {
        i++;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") stack.push(c);
    else if (c in pairs) {
      if (stack.pop() !== pairs[c]) return true; // mismatch -> let it submit so user sees the error
    }
  }
  return stack.length === 0;
}

rl.setCheckHandler(balanced);

// Trivial paren-matching highlighter: when the cursor is on '(' or ')',
// color it and its match. Exercises the SGR-spanning-rows path.
const highlighter: Highlighter = {
  highlight(line: string, pos: number): string {
    if (pos < 0 || pos >= line.length) return line;
    const c = line[pos];
    const open = "([{";
    const close = ")]}";
    let match = -1;
    if (open.includes(c)) {
      const want = close[open.indexOf(c)];
      let depth = 0;
      for (let i = pos; i < line.length; i++) {
        if (line[i] === c) depth++;
        else if (line[i] === want) {
          depth--;
          if (depth === 0) {
            match = i;
            break;
          }
        }
      }
    } else if (close.includes(c)) {
      const want = open[close.indexOf(c)];
      let depth = 0;
      for (let i = pos; i >= 0; i--) {
        if (line[i] === c) depth++;
        else if (line[i] === want) {
          depth--;
          if (depth === 0) {
            match = i;
            break;
          }
        }
      }
    }
    if (match === -1) return line;
    const [a, b] = pos < match ? [pos, match] : [match, pos];
    const wrap = (s: string) => `\x1b[1;33m${s}\x1b[0m`;
    return (
      line.slice(0, a) +
      wrap(line[a]) +
      line.slice(a + 1, b) +
      wrap(line[b]) +
      line.slice(b + 1)
    );
  },
  highlightPrompt(prompt: string): string {
    return `\x1b[1;32m${prompt}\x1b[0m`;
  },
  highlightChar(line: string, pos: number): boolean {
    return pos >= 0 && pos < line.length && "()[]{}".includes(line[pos]);
  },
};
rl.setHighlighter(highlighter);

rl.println("xterm-readline demo. Multi-line: Enter inserts \\n until ()[]{}");
rl.println("are balanced. Try ?rows=10&cols=40 in the URL for a small viewport.");
rl.println("");

function loop() {
  rl.read("> ")
    .then((input) => {
      rl.println(`=> ${JSON.stringify(input)}`);
      setTimeout(loop);
    })
    .catch((err) => rl.println(`error: ${err}`));
}
loop();
