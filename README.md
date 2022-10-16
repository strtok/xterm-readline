# Xterm.js Readline
[![node ci](https://github.com/strtok/xterm-readline/actions/workflows/node.js.yml/badge.svg)](https://github.com/strtok/xterm-readline/actions/workflows/node.js.yml)

This is an xterm-js addon that provides a readline like capability to xterm-js. It allows the creation of cli or repl like interfaces on top of xterm-js.

Large parts of this source are inspired / derived / ported from the MIT licensed [rustyline](https://github.com/kkawakam/rustyline) project.

# Features

* Multi-line prompt and input
* Extendable syntax highlighting
* Unicode / multi column-width character support

# Example

This is a multi-line example that treats any line ending with '&&' as a continuation.

```typescript
import "xterm/css/xterm.css";
import { Terminal } from 'xterm';
import { Readline } from "xterm-readline";

const term = new Terminal({
  theme: {
        background: "#191A19",
        foreground: "#F5F2E7",
  },
  cursorBlink: true,
  cursorStyle: "block"
});

const rl = new Readline();

term.loadAddon(rl);
term.open(document.getElementById('terminal'));
term.focus();

rl.setCheckHandler((text) => {
  let trimmedText = text.trimEnd();
  if (trimmedText.endsWith("&&")) {
    return false;
  }
  return true;
});

function readLine() {
  rl.read(">")
    .then(processLine);
}

function processLine(text) {
  rl.println("you entered: " + text);
  setTimeout(readLine);
}

readLine();
```

# Keyboard Shortcuts

Key             | Action
---------       | ------
Home            | Move cursor to the beginning of line
End             | Move cursor to end of line
Left            | Move cursor one character left
Right           | Move cursor one character right
Up              | Move cursor up (multi-line edit)
Down            | Move cursor down (multi-line edit)
Ctrl-C          | Cancel line in progress (additionally call ctrl-c callback if registered)
Ctrl-D, Del     | Delete the character under the cursor
Enter           | Apply the line, or begin a new line in multiline mode
Alt/Shift Enter | Force add \n to the input
Ctrl-U          | Clear line
Ctrl-K          | Delete text from cursor to end of line

# Real World Uses

* [Marwood](https://github.com/strtok/marwood)

# License Agreement

If you contribute code to this project, you implicitly allow your code to be distributed under the MIT license. 