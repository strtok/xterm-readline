# Intro

This is an xterm-js addon that provides a readline like capability to xterm-js. It allows the creation of cli or repl like interfaces on top of xterm-js.

Large parts of this source are inspired / derived / ported from the MIT licensed [rustyline](https://github.com/kkawakam/rustyline) project.

# Features

* Multi-line prompt and input
* Extendable syntax highlighting
* Unicode / multi column-width character support

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
Ctrl-U       | Clear line

# Real World Uses

* [Marwood](https://github.com/strtok/marwood)

# License Agreement

If you contribute code to this project, you implicitly allow your code to be distributed under the MIT license. 