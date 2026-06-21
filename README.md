> [!note]
> This plugin was created entirely with AI tools

# Codeblock Autocomplete

Provides auto-complete when creating fenced code blocks by typing backticks/tildes in the markdown editor, plus a few other utilities:

- Copy button for code blocks in the markdown editor
- Toolbar button/Editor command to insert new code block or wrap existing text in a code block

Codemirror 6 only, legacy editor is not supported.

![ex](https://github.com/bwat47/joplin-codeblock-autocomplete/blob/main/images/example.gif)

## Usage

### Autocomplete

Typing an opening fence (three+ backticks or three+ tildes) will trigger the auto-complete list by default. Selecting a language will complete the code block (adding the language and closing fence).

- Specifying a lanauge that's not in the list (and has no matches) will show "Custom language" and will use the specified language as-is.

- Supports nested code blocks (when the autocomplete languages dropdown is enabled): enter more than three fence characters will close the block with the same number of fence characters as the opening block.

- If language auto-complete is disabled, typing exactly three backticks or tildes immediately inserts the closing fence and leaves the cursor at the end of the opening fence so you can type a language or press Enter.

### Insert code block command

An insert code block command is available via a formatting toolbar icon, Edit menu entry, and keyboard shortcut (by default CmdOrCtrl + Alt + `).

The command supports multiple cursors and selections, and is line-aware (e.g. cursor on line with no selection > invoke command > wraps entire line in code block).

### Copy button

If the copy widget is enabled, you will see the code fence language rendered as a clickable copy button on the top-right of the code block (when the cursor isn't on the opening fence line).

Clicking the copy button will copy the code block contents to your clipboard. If the code fence doesn't have a language specified, it will display a generic "Copy" label instead of the language.

## Settings

Enable language auto-complete - Toggle the language dropdown for code fences. When disabled, typing exactly three backticks or tildes inserts a closing fence immediately without opening the dropdown.

Autocomplete languages - Comma-separated list of language identifiers to show in the autocomplete menu.

Enable code block copy widget - Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.
