# Codeblock Autocomplete Architecture

## Purpose

This plugin adds CodeMirror 6 editor enhancements for fenced code blocks in Joplin. The feature set is split between the main plugin process and a CodeMirror content script.

## Runtime Layout

- Main plugin process:
    - registers plugin settings
    - registers the CodeMirror content script
    - registers the editor toolbar command
    - responds to content-script messages for settings hydration and clipboard copy
    - pushes updated settings into the active editor when Joplin settings change
- CodeMirror content script:
    - installs the editor extensions used by the plugin
    - holds the current plugin settings in editor state
    - provides fenced code block autocomplete behavior
    - provides the insert-code-block editor command
    - provides the optional copy widget decoration layer

## Source Layout

```text
src/
├── index.ts
├── settings.ts
└── contentScript/
    ├── index.ts
    ├── codeMirror6Plugin.ts
    ├── pluginSettings.ts
    ├── fenceAutocomplete.ts
    ├── insertCodeBlock.ts
    ├── copyWidget.ts
    └── types.ts
```

## Module Responsibilities

### Main Process

- `src/index.ts`
    - plugin entry point
    - wires Joplin registration, toolbar integration, message handling, and settings updates
- `src/settings.ts`
    - defines and registers plugin settings
    - converts Joplin settings into the normalized shape used by the content script

### Content Script

- `src/contentScript/index.ts`
    - content script entry point for CodeMirror 6
- `src/contentScript/codeMirror6Plugin.ts`
    - composition root for the editor-side extensions and commands
- `src/contentScript/pluginSettings.ts`
    - stores plugin settings in CodeMirror state and syncs them from the main process
- `src/contentScript/fenceAutocomplete.ts`
    - handles fence detection and language autocomplete
- `src/contentScript/insertCodeBlock.ts`
    - inserts a fenced code block from the toolbar command
- `src/contentScript/copyWidget.ts`
    - tracks visible fenced code blocks for the optional copy button
    - separates structural block discovery from selection-driven presentation updates
    - resolves copied text from the current editor state when the button is clicked
- `src/contentScript/types.ts`
    - shared content-script message and command types

## Main Flow

1. Joplin starts the plugin through `src/index.ts`.
2. The plugin registers settings, the content script, and the toolbar button.
3. The content script loads `src/contentScript/codeMirror6Plugin.ts` for CodeMirror 6 editors.
4. The content script requests current settings from the main process and stores them in editor state.
5. Editor features read from that shared state for autocomplete, code block insertion, and the optional copy widget.
6. When plugin settings change, the main process pushes the new values back into the active editor.

## Notes

- This document is intentionally limited to architecture and file layout.
- User-facing behavior and detailed feature rules should stay in README-level documentation or tests, not here.
