# Codeblock Autocomplete - Architecture Documentation

## Overview

Joplin plugin that provides language autocompletion when typing ` ``` ` or `~~~` in the markdown editor. By default it shows a dropdown of configured languages and inserts a complete fenced code block. It also supports a setting that disables the dropdown and immediately inserts a closing fence after typing exactly three backticks or tildes. An optional copy-widget setting adds a syntax-tree-driven decoration layer that hides the opening-fence language text when the cursor is not on that line and renders a copy control on the top-right of the opening fence. Supports both backtick and tilde fences, 3+ fence characters for nested code blocks in dropdown mode, custom languages not in settings, and indentation matching.

## File Structure

```
src/
├── index.ts              # Plugin entry point, registers settings and content script
├── settings.ts           # Settings registration and main-process access helpers
└── contentScript/
    ├── index.ts          # Content script entry, loads CM6 plugin
    ├── codeMirror6Plugin.ts  # Core autocomplete logic
    └── types.ts          # Shared content-script settings types and command constants
```

## Architecture

### Data Flow

1. **Startup**: `index.ts` registers settings, registers the content script, and listens for setting changes to push updated settings into the active editor
2. **Content Script Load**: `contentScript/index.ts` initializes `codeMirror6Plugin` for CM6 editors
3. **Initial Settings Hydration**: the content script fetches the current settings once via `postMessage`, then reconfigures a CM6 compartment-backed settings facet
4. **User Types ` ``` ` or `~~~`**: `EditorView.updateListener` detects pattern and either triggers `startCompletion()` or inserts an immediate closing fence depending on the facet-backed setting
5. **Completion Request**: `codeBlockCompleter` reads the latest settings from the CM6 facet and builds ordered options when language autocomplete is enabled
6. **Copy Widget Sync**: a CM6 `ViewPlugin` recomputes decorations directly from `update.view`, using `ensureSyntaxTree()` for the current viewport and the facet-backed settings snapshot
7. **Selection**: User picks language, `apply` function inserts complete code block
8. **Copy Action**: the content-script widget sends a `copyCodeBlock` message to the main process, which writes the code body to Joplin's clipboard API

### Key Components

**`settings.ts`**

- Registers `codeblockAutocomplete.enableLanguageAutocomplete` setting (boolean)
- Registers `codeblockAutocomplete.enableCopyWidget` setting (boolean, default `false`)
- Registers `codeblockAutocomplete.languages` setting (comma-separated string)
- `getContentScriptSettings()` reads the current settings directly from Joplin and returns the language list plus enable flags for the content script
- `arePluginSettingsChanged()` identifies whether a Joplin settings change event affects this plugin
- Serves as the main-process bridge for initial content-script hydration and for pushing later setting changes into the active editor command

**`codeMirror6Plugin.ts`**

- `parseOpeningFence()` - Parses current line to extract indent, fence character (`` ` `` or `~`), fence count (3+), typed language, and language start position
- `pluginSettingsFacet` / `pluginSettingsCompartment` - Stores the shared content-script settings in CM6 state and allows runtime reconfiguration from a custom editor command
- `buildCompletionOptions()` - Filters configured languages case-insensitively, preserves explicit ordering, and suppresses redundant custom-language entries when casing differs
- `createApplyFunction()` - Creates completion handler that replaces typed language and inserts closing fence with matching character
- `getFenceTriggerPosition()` / `handleFenceTrigger()` - Detect opening-fence typing and either auto-trigger completion or immediately insert a closing fence when the dropdown is disabled
- `buildCopyWidgetDecorations()` - Walks the markdown syntax tree for the visible viewport, finds `FencedCode` nodes, hides the opening-fence language text, and adds a copy widget decoration when the cursor is not on the opening fence line
- `getFencedCodeBlockInfo()` - Derives the opening line, `CodeInfo`, closing fence, and copyable code body from a `FencedCode` syntax node
- `syncInitialSettings()` - Fetches initial settings from the main process and seeds the facet-backed configuration
- `CopyWidgetViewPlugin` - Stores decorations directly on the `ViewPlugin` instance and recomputes them when the document, selection, viewport, or facet-backed settings change
- `CopyCodeBlockWidget` - Renders the language label or generic copy icon and posts `copyCodeBlock` messages back to the main process

**`types.ts`**

- `PluginContext` - Joplin content script context with `postMessage`
- `PluginSettingsResponse` - Content-script settings snapshot including autocomplete and copy-widget flags
- `UPDATE_SETTINGS_COMMAND` - Shared editor command name used by the main plugin to push updated settings into active editors

## Settings

| Key                               | Type   | Description                          |
| --------------------------------- | ------ | ------------------------------------ |
| `codeblockAutocomplete.enableLanguageAutocomplete` | boolean | Enable the language dropdown for fenced code blocks |
| `codeblockAutocomplete.enableCopyWidget` | boolean | Show the code block copy widget and hide opening-fence language text when appropriate |
| `codeblockAutocomplete.languages` | string | Comma-separated language identifiers |

Default languages: javascript, typescript, python, bash, shell, html, css, sql, json, xml, yaml, markdown, c, cpp, csharp, java, go, rust, php, ruby, swift, kotlin

## Completion Behavior

- Triggers on both backtick (` ``` `) and tilde (`~~~`) fences when preceded by whitespace on the line
- When `enableLanguageAutocomplete` is enabled, the current dropdown flow remains unchanged
- First option is always `No language` when no language typed
- Configured language options follow, filtered case-insensitively by typed prefix (e.g., ` ```py ` shows python)
- Supports language names with hyphens and special characters (e.g., `objective-c`, `c++`)
- Custom languages not in settings appear after all matched languages (e.g., typing ` ```bobo ` adds "bobo" below any matches)
- Closing fence matches opening fence character and count (e.g., `~~~~` closes with `~~~~`, ``` ```` ``` closes with ``` ```` ```) and indentation
- Selection replaces typed language and inserts closing fence, cursor positioned inside block
- When `enableLanguageAutocomplete` is disabled, typing exactly three backticks or tildes inserts a matching three-character closing fence immediately, preserves indentation, and keeps the cursor at the end of the opening fence line

## Copy Widget Behavior

- Enabled only when `enableCopyWidget` is `true`
- Uses the markdown syntax tree (`FencedCode`, `CodeInfo`, and `CodeMark` nodes) instead of regex scanning to find visible fenced code blocks
- Reads the current enable flag from the shared CM6 settings facet instead of maintaining a separate plugin-local cache
- When the cursor is not on the opening fence line:
  - Hides the language text on the opening fence line when a language is present
  - Shows a top-right widget on the opening fence line
  - Uses the language text as the widget label when a language exists
  - Uses a generic copy icon widget when no language is present
- When the cursor is on the opening fence line:
  - Leaves the opening fence text visible
  - Hides the copy widget
- Clicking the widget copies only the code block body, excluding the opening and closing fence lines
- Decoration updates are driven by document changes, selection changes, viewport changes, and facet reconfiguration when the main process pushes updated settings
