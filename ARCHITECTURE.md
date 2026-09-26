# Codeblock Utils Architecture

## Purpose and Scope

Codeblock Utils adds fenced-code-block utilities to Joplin's CodeMirror 6 editor and Markdown viewer: language autocomplete, code block insertion, copy buttons, and line numbers.

This document describes component boundaries and data flow. Detailed feature behavior belongs in the README and tests; implementation constraints belong alongside the code.

## Runtime Components

| Component                      | Entry point                              | Responsibility                                                                                                                                |
| ------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Main plugin process            | `src/index.ts`                           | Registers settings, content scripts, and menu/toolbar commands; handles clipboard access and copy feedback; forwards editor settings updates. |
| CodeMirror content script      | `src/contentScripts/codemirror/index.ts` | Installs editor extensions and commands for autocomplete, code block insertion, copy buttons, and line numbers.                               |
| Markdown viewer content script | `src/contentScripts/viewer/index.ts`     | Extends fenced-code rendering with optional copy buttons and line numbers, supported by viewer JavaScript and CSS assets.                     |

The main process owns Joplin API integration. Content scripts own editor or viewer behavior and request main-process services through messages.

## Settings and Communication

- `src/settings.ts` defines and registers settings and prepares the editor settings payload. `src/settingsKeys.ts` shares setting identifiers without importing the main-process Joplin API.
- On initialization, the editor requests settings from the main process. `codemirror/pluginSettings.ts` stores them in CodeMirror state for editor features to read. Later changes are pushed to the active editor through an editor command.
- The viewer reads its independent settings through Joplin's Markdown renderer options. Changes take effect through Joplin's normal Markdown rerender lifecycle.
- Menu and toolbar actions route through the main process to the editor's code block insertion command.
- Copy actions in either content script send text to the main process, which writes it to the clipboard and shows success feedback.

## Editor Organization

Paths below are relative to `src/contentScripts/codemirror/`.

| Module                            | Responsibility                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `codeMirror6Plugin.ts`            | Composition root: assembles extensions and registers editor commands.                    |
| `pluginSettings.ts`, `types.ts`   | Editor settings state and message/command contracts.                                     |
| `fenceAutocomplete.ts`            | Fence-triggered language completion.                                                     |
| `insertCodeBlock.ts`              | Editing commands that wrap or unwrap fenced code blocks.                                 |
| `copyWidget.ts`, `lineNumbers.ts` | Optional editor decorations for copying and numbering code.                              |
| `fencedCodeBlock.ts`              | Shared syntax-tree discovery and block geometry used by editing and decoration features. |

Keep document changes in editing commands and presentation in decoration modules. Reuse the shared block helpers for features that need fenced-code boundaries.

## Viewer Organization

Paths below are relative to `src/contentScripts/viewer/`.

| Module                              | Responsibility                                                           |
| ----------------------------------- | ------------------------------------------------------------------------ |
| `index.ts`                          | Wraps the existing Markdown-it fence renderer and exposes viewer assets. |
| `codeContainer.ts`                  | Shared identification and marking of eligible rendered code containers.  |
| `viewerLineNumbers.ts`              | Marks containers for optional line numbering during rendering.           |
| `copyWidget.js`, `copyWidget.css`   | Copy interaction and button presentation.                                |
| `lineNumbers.js`, `lineNumbers.css` | Line-number DOM decoration and presentation.                             |

The viewer preserves Joplin's existing rendered HTML and source metadata. It decorates ordinary rendered code containers, leaving specialized fence renderers such as diagrams untouched. Viewer decorations preserve the code text used for copying.

## Compatibility and Maintenance

The display name is Codeblock Utils, but the package name (`joplin-plugin-codeblock-autocomplete`), manifest ID (`com.bwat47.codeblock-autocomplete`), existing setting keys, and runtime identifiers retain their original names for compatibility.

Tests live alongside feature modules; shared editor test support is in `src/testUtils/editorHarness.ts`. Logging uses `src/logger.ts`. Update this document when component responsibilities or communication paths change.
