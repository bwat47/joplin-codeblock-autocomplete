> [!note]
> This plugin was created entirely with AI tools

# Codeblock Autocomplete

Provides auto-complete when creating fenced code blocks.

Codemirror 6 only, legacy editor is not supported.

![example](https://github.com/user-attachments/assets/2681aa4e-e3e4-44e4-84ae-b68df16c8b1a)

## Usage

Typing an opening fence (three+ backticks or three+ tildes) will trigger the auto-complete list. Selecting a language will complete the code block (adding the language and closing fence).

- Specifying a lanauge that's not in the list (and has no matches) will show "Custom language" and will use the specified language as-is.

- Supports nested code blocks (enter more than three fence characters will close the block with the same number of fence characters as the opening block).

- Changing the language of the opening fence of an existing complete code block will not trigger the auto-complete, to prevent addition of an extra closing fence.

## Settings

Autocomplete languages - Comma-separated list of language identifiers to show in the autocomplete menu.
