> [!note]
> This plugin was created entirely with AI tools

# Codeblock Autocomplete

Provides auto-complete when creating fenced code blocks by typing backticks/tildes in the Markdown editor, plus a few additional code block features:

- Copy button for code blocks in the Markdown editor
- Copy button for fenced code blocks in the Markdown viewer (and Rich Text editor)
- Toolbar button/Editor command to insert new code block or wrap existing text in a code block in the Markdown Editor

![ex](https://github.com/bwat47/joplin-codeblock-autocomplete/blob/main/images/example.gif)

## Usage

### Autocomplete

Typing an opening fence (three+ backticks or three+ tildes) will trigger the auto-complete list by default. Selecting a language will complete the code block (adding the language and closing fence).

- Specifying a lanauge that's not in the list (and has no matches) will show "Custom language" and will use the specified language as-is.

- Supports nested code blocks (when the autocomplete languages dropdown is enabled): enter more than three fence characters will close the block with the same number of fence characters as the opening block.

- If language auto-complete is disabled, typing exactly three backticks or tildes immediately inserts the closing fence and leaves the cursor at the end of the opening fence so you can type a language or press Enter.

### Insert code block command

An insert code block command is available via a formatting toolbar icon, Edit menu entry, and keyboard shortcut (by default CmdOrCtrl + Alt + `).

The command supports multiple cursors and selections, and is line-aware (e.g. cursor on line with no selection > invoke command > wraps entire line in code block). Invoking it with a cursor or selection inside an existing fenced code block removes the surrounding fence lines.

### Markdown editor copy button

If the copy widget is enabled, you will see the code fence language rendered as a clickable copy button on the top-right of the code block (when the cursor isn't on the opening fence line).

Clicking the copy button will copy the code block contents to your clipboard. If the code fence doesn't have a language specified, it will display a generic "Copy" label instead of the language.

### Markdown viewer copy button

The Markdown viewer has a separate copy-widget setting. When enabled, hovering over a rendered fenced code block shows an icon-only copy button in its top-right corner. The button remains visible on touch devices and can also be reached with the keyboard.

Clicking the button copies the fenced code contents and displays a success toast. Indented code blocks, inline code, raw HTML code blocks, and fences that Joplin renders as something other than code (Mermaid, ABC notation, Fountain) are not changed.

> [!note]
> This setting also enables a working copy button in the desktop rich text editor (TinyMCE).
>
> It technically works in the mobile (prosemirror) rich text editor as well, however, the prosemirror editor places its own "edit" button on the top right, so the two buttons overlap.

## Settings

Enable language auto-complete - Toggle the language dropdown for code fences. When disabled, typing exactly three backticks or tildes inserts a closing fence immediately without opening the dropdown.

Autocomplete languages - Comma-separated list of language identifiers to show in the autocomplete menu.

Enable Markdown editor copy widget - Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.

Enable Markdown viewer copy widget - Show a copy button when hovering over fenced code blocks in the Markdown viewer.
