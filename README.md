> [!note]
> This plugin was created entirely with AI tools

# Codeblock Autocomplete

Provides auto-complete when creating fenced code blocks, plus a few other utilities:

- Copy button for code blocks in the markdown editor
- Toolbar button to insert new code block

Codemirror 6 only, legacy editor is not supported.

<img width="2234" height="1714" alt="ex" src="https://github.com/user-attachments/assets/cb806e10-b4bb-4079-a933-1366c6d15a3d" />

## Usage

Typing an opening fence (three+ backticks or three+ tildes) will trigger the auto-complete list by default. Selecting a language will complete the code block (adding the language and closing fence).

- Specifying a lanauge that's not in the list (and has no matches) will show "Custom language" and will use the specified language as-is.

- Supports nested code blocks (when the language dropdown is enabled): enter more than three fence characters will close the block with the same number of fence characters as the opening block.

- If language auto-complete is disabled, typing exactly three backticks or tildes immediately inserts the closing fence and leaves the cursor at the end of the opening fence so you can type a language or press Enter.

## Settings

Enable language auto-complete - Toggle the language dropdown for code fences. When disabled, typing exactly three backticks or tildes inserts a closing fence immediately without opening the dropdown.

Autocomplete languages - Comma-separated list of language identifiers to show in the autocomplete menu.

Enable code block copy widget - Show a copy button on fenced code blocks in the Markdown editor and hide the opening-fence language text when the cursor is not on that line.
