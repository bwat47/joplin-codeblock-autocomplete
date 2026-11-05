> [!note]
> This plugin was created entirely with AI tools

# Codeblock Utils

Codeblock Utils adds tools for working with fenced code blocks in Joplin:

- Language autocomplete when typing backticks or tildes in the Markdown editor
- Copy button for fenced code blocks in the Markdown editor
- Copy button for fenced code blocks in the Markdown viewer (and Rich Text editor)
- Optional line numbers for fenced code blocks in the Markdown editor and viewer, which individual blocks can turn on or off
- Toolbar button, Edit menu command, and keyboard shortcut to insert, wrap, or unwrap code blocks in the Markdown editor

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

### Markdown editor line numbers

If line numbers are enabled, each line inside a fenced code block in the Markdown editor is numbered, starting from 1 on the line after the opening fence. The fence lines are shifted to stay aligned with the code but are not numbered. Individual blocks can override this setting with [per-block options](#per-block-line-number-options).

### Markdown viewer copy button

The Markdown viewer has a separate copy-widget setting. When enabled, hovering over a rendered fenced code block shows an icon-only copy button in its top-right corner. The button remains visible on touch devices and can also be reached with the keyboard.

Clicking the button copies the fenced code contents and displays a success toast. Indented code blocks, inline code, raw HTML code blocks, and fences that Joplin renders as something other than code (Mermaid, ABC notation, Fountain) are not changed.

> [!note]
> This setting also enables a working copy button in the desktop rich text editor (TinyMCE).
>
> It technically works in the mobile (prosemirror) rich text editor as well, however, the prosemirror editor places its own "edit" button on the top right, so the two buttons overlap.

### Markdown viewer line numbers

Enable the viewer line-number setting to number each logical line of fenced code, starting from 1 for each block. Highlighting is preserved, and copying code excludes the numbers. This setting is independent of editor line numbers and viewer copy buttons. Diagram blocks are not numbered. Individual blocks can override this setting with [per-block options](#per-block-line-number-options).

### Per-block line number options

Options written after the language on the opening fence control line numbers for that block, in both the Markdown editor and the viewer:

| Option     | Effect                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------- |
| `ln`       | Number this block, even when the line-number setting is off.                                          |
| `ln=false` | Never number this block, even when the line-number setting is on.                                     |
| `start=N`  | Start numbering at `N` (a whole number, 0 or more). Also numbers the block, unless `ln=false` is set. |

For example:

````markdown
```python ln start=10
def greet(name):
    return f"Hello, {name}"
```
````

- The language must come first, since Joplin uses the first word for syntax highlighting. To number a block that has no language, use a placeholder such as `text ln`.
- Options can be written in any order. Unknown or invalid options are ignored.
- The editor copy button shows only the language, not the options.
- Other Markdown apps ignore the extra words and use the first one as the language.
- The rich text editor keeps the options when saving, copying, or editing a code block. In the desktop editor's code block dialog, the options appear in the Language field.

## Settings

Enable language auto-complete - Toggle the language dropdown for code fences. When disabled, typing exactly three backticks or tildes inserts a closing fence immediately without opening the dropdown.

Enable Markdown editor copy widget - Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.

Show line numbers in Markdown editor code blocks - Number the lines inside fenced code blocks in the Markdown editor. Blocks can override this with `ln` or `ln=false`.

Enable Markdown viewer copy widget - Show a copy button when hovering over fenced code blocks in the Markdown viewer.

Show line numbers in Markdown viewer code blocks - Number the lines inside fenced code blocks in the Markdown viewer. Blocks can override this with `ln` or `ln=false`.

Autocomplete languages - Comma-separated list of language identifiers to show in the autocomplete menu.
