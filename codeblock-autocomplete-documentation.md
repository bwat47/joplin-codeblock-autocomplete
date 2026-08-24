# Codeblock Autocomplete Architecture

## Purpose

This plugin adds fenced-code-block utilities to Joplin's CodeMirror 6 editor and Markdown viewer. The feature set is split between the main plugin process and editor/viewer content scripts.

## Runtime Layout

- Main plugin process:
    - registers plugin settings and both content scripts
    - registers the insert-code-block command with Edit menu and editor toolbar entry points
    - responds to editor/viewer messages for settings hydration and clipboard copy
    - pushes updated settings into the active editor when Joplin settings change
- CodeMirror content script:
    - installs the editor extensions used by the plugin
    - holds the current plugin settings in editor state
    - provides fenced code block autocomplete behavior
    - provides the insert-code-block editor command
    - provides the optional copy widget decoration layer
- Markdown viewer content script:
    - extends only Markdown-it's fenced-code renderer while preserving Joplin's existing rendered HTML
    - reads the viewer setting through Joplin's renderer options and injects the optional icon-only copy button into Joplin's fenced-code container
    - loads viewer JavaScript and CSS for hover/focus presentation and delegated copy actions

## Source Layout

```text
src/
├── index.ts
├── settings.ts
├── settingsKeys.ts
└── contentScripts/
    ├── codemirror/
    │   ├── index.ts
    │   ├── codeMirror6Plugin.ts
    │   ├── pluginSettings.ts
    │   ├── fenceAutocomplete.ts
    │   ├── fencedCodeBlock.ts
    │   ├── insertCodeBlock.ts
    │   ├── copyWidget.ts
    │   └── types.ts
    └── viewer/
        ├── index.ts
        ├── copyWidget.js
        └── copyWidget.css
```

## Module Responsibilities

### Main Process

- `src/index.ts`
    - plugin entry point
    - wires Joplin registration, toolbar integration, message handling, and settings updates
- `src/settings.ts`
    - defines and registers plugin settings
    - returns the settings payload for the editor content script
- `src/settingsKeys.ts`
    - defines shared plugin setting keys without importing the main-process Joplin API

### CodeMirror Content Script

- `src/contentScripts/codemirror/index.ts`
    - content script entry point for CodeMirror 6
- `src/contentScripts/codemirror/codeMirror6Plugin.ts`
    - composition root for the editor-side extensions and commands
- `src/contentScripts/codemirror/pluginSettings.ts`
    - stores plugin settings in CodeMirror state and syncs them from the main process
- `src/contentScripts/codemirror/fenceAutocomplete.ts`
    - handles fence detection and language autocomplete
- `src/contentScripts/codemirror/fencedCodeBlock.ts`
    - shared syntax-tree helpers for locating fenced code blocks
    - resolves a `FencedCode` node into line and content offsets (`FencedCodeBlockGeometry`) so `insertCodeBlock.ts` and `copyWidget.ts` do not each repeat the fence arithmetic
    - `openingFenceFrom` starts after a list marker on the fence line, so removing a fence written as `- ```js` keeps the list item; blockquote markers need no such care because they repeat on every line
    - reports whether syntax parsing reached the requested position when returning its parse-timeout fallback; mutation commands fail safely on an incomplete tree, while presentation-only consumers may use the partial tree
- `src/contentScripts/codemirror/insertCodeBlock.ts`
    - toggles fenced code block formatting from the toolbar command
    - removes the enclosing fence lines when the cursor or selection is inside an existing fenced code block
    - line-aware: each cursor/selection is expanded to the whole lines it touches, so a bare cursor on a line of text wraps that line and a partial selection wraps the full line(s) it spans (a bare cursor on an empty line still inserts an empty block)
    - supports multiple cursors and selections in a single transaction: expanded spans that share lines are merged into one block, and the original cursors/selections are re-anchored inside their block, preserving column and direction
    - sizes each opening/closing fence one backtick past the longest fence in the text it wraps, so wrapping content that already contains fences cannot end the new block early
- `src/contentScripts/codemirror/copyWidget.ts`
    - tracks visible fenced code blocks for the optional copy button
    - separates structural block discovery from selection-driven presentation updates
    - resolves copied text from the current editor state when the button is clicked
- `src/contentScripts/codemirror/types.ts`
    - shared content-script message and command types

### Markdown Viewer Content Script

- `src/contentScripts/viewer/index.ts`
    - wraps the existing Markdown-it `fence` renderer and leaves all other renderer rules unchanged
    - reads the viewer setting through Markdown-it's `pluginOptions.settingValue()` callback
    - injects one accessible copy button only when enabled and the rendered output is a Joplin fenced-code container
    - Joplin's own `fence` overrides (Mermaid, ABC, Fountain) also emit a `joplin-editable` container and are installed before content-script rules, so container detection alone is not enough; the renderer additionally requires a rendered `<code>` element, which only Joplin's code renderer emits
    - appends a marker class to the container it injects into, so the stylesheet can scope its rules without `:has()`
    - exposes the viewer JavaScript and CSS assets
- `src/contentScripts/viewer/copyWidget.js`
    - delegates button clicks through the viewer content-script message channel
    - reads the original `.joplin-source` text, with rendered code as a fallback
    - copies that text verbatim: Joplin already strips the newline belonging to the closing fence, so any newline still present is one the author wrote and must be preserved
- `src/contentScripts/viewer/copyWidget.css`
    - provides hover, focus, touch, theme-compatible, and print behavior for the icon-only button
    - keys off the renderer's marker class rather than `:has()`, which would otherwise be the newest feature the viewer depends on and whose absence would strand the absolutely positioned button outside its block
    - renders the button as a bare icon (no padding or chip) that greys out at rest and takes the note's text colour on hover or focus, over a `backdrop-filter` blur so a horizontally scrolled line of code does not show through it
    - fits the icon to the block: sized in `em` (`min(1.4em, 100%)` on both axes, with `aspect-ratio: 1` governing the clamped case and the explicit width as its fallback) so it tracks the viewer font, with a `clamp()` top offset that centres it vertically once a block is too short for the full inset — Joplin renders fenced code with no padding, so a single-line block is only one line tall — and the rendered `pre` gets `padding-right` so code does not end underneath it

## Main Flow

1. Joplin starts the plugin through `src/index.ts`.
2. The plugin registers settings, the CodeMirror and Markdown viewer content scripts, the Edit menu item, and the toolbar button.
3. The CodeMirror content script loads `src/contentScripts/codemirror/codeMirror6Plugin.ts` for CodeMirror 6 editors.
4. The CodeMirror content script requests current settings from the main process and stores them in editor state.
5. Editor features read from that shared state for autocomplete, code block insertion, and the optional editor copy widget.
6. The viewer content script reads its independent setting from Joplin's renderer options and injects buttons only for enabled Markdown-it fence tokens.
7. Copy actions from either content script use the main process's clipboard helper and success toast.
8. Editor setting changes are pushed into the active editor; viewer setting changes are applied through Joplin's normal Markdown rerender lifecycle.

## Notes

- This document is intentionally limited to architecture and file layout.
- User-facing behavior and detailed feature rules should stay in README-level documentation or tests, not here.
