> [!note]
> This plugin was created entirely with AI tools

# Codeblock Autocomplete

Provides auto-complete when creating fenced code blocks.

Codemirror 6 only, legacy editor is not supported.

![example](https://github.com/user-attachments/assets/2681aa4e-e3e4-44e4-84ae-b68df16c8b1a)

## Usage

Typing an opening fence (three+ backticks or three+ tildes) will trigger the auto-complete list by default. Selecting a language will complete the code block (adding the language and closing fence).

- Specifying a lanauge that's not in the list (and has no matches) will show "Custom language" and will use the specified language as-is.

- Supports nested code blocks (enter more than three fence characters will close the block with the same number of fence characters as the opening block).

- If language auto-complete is disabled, typing exactly three backticks or tildes immediately inserts the closing fence and leaves the cursor at the end of the opening fence so you can type a language or press Enter.

## Settings

Enable language auto-complete - Toggle the language dropdown for code fences. When disabled, typing exactly three backticks or tildes inserts a closing fence immediately without opening the dropdown.

Autocomplete languages - Comma-separated list of language identifiers to show in the autocomplete menu.
