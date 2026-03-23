# Codeblock Autocomplete - Architecture Documentation

## Overview

Joplin plugin that provides language autocompletion when typing ` ``` ` or `~~~` in the markdown editor. By default it shows a dropdown of configured languages and inserts a complete fenced code block. It also supports a setting that disables the dropdown and immediately inserts a closing fence after typing exactly three backticks or tildes. Supports both backtick and tilde fences, 3+ fence characters for nested code blocks in dropdown mode, custom languages not in settings, and indentation matching.

## File Structure

```
src/
├── index.ts              # Plugin entry point, registers settings and content script
├── settings.ts           # Settings registration and cache management
└── contentScript/
    ├── index.ts          # Content script entry, loads CM6 plugin
    ├── codeMirror6Plugin.ts  # Core autocomplete logic
    └── types.ts          # TypeScript interfaces for Joplin/CodeMirror
```

## Architecture

### Data Flow

1. **Startup**: `index.ts` registers settings, initializes cache, registers content script
2. **Content Script Load**: `contentScript/index.ts` initializes `codeMirror6Plugin` for CM6 editors
3. **User Types ` ``` ` or `~~~`**: `EditorView.updateListener` detects pattern and either triggers `startCompletion()` or inserts an immediate closing fence depending on the setting
4. **Completion Request**: `codeBlockCompleter` fetches current settings via `postMessage` from the main-process cache, then builds ordered options when language autocomplete is enabled
5. **Selection**: User picks language, `apply` function inserts complete code block

### Key Components

**`settings.ts`**

- Registers `codeblockAutocomplete.enableLanguageAutocomplete` setting (boolean)
- Registers `codeblockAutocomplete.languages` setting (comma-separated string)
- Maintains `settingsCache` for sync access
- `getLanguageList()` parses setting into string array
- `getContentScriptSettings()` returns the current language list and enable flag for the content script
- Serves as the single source of truth for runtime settings; the content script reads from this cache on demand instead of keeping its own copy

**`codeMirror6Plugin.ts`**

- `parseOpeningFence()` - Parses current line to extract indent, fence character (`` ` `` or `~`), fence count (3+), typed language, and language start position
- `getSettings()` - Fetches the latest settings snapshot from the main process using `postMessage`
- `buildCompletionOptions()` - Filters configured languages case-insensitively, preserves explicit ordering, and suppresses redundant custom-language entries when casing differs
- `createApplyFunction()` - Creates completion handler that replaces typed language and inserts closing fence with matching character
- `getFenceTriggerPosition()` / `handleFenceTrigger()` - Detect opening-fence typing and either auto-trigger completion or immediately insert a closing fence when the dropdown is disabled

**`types.ts`**

- `PluginContext` - Joplin content script context with `postMessage`
- `JoplinCodeMirror` - CM wrapper with `joplinExtensions.completionSource`

## Settings

| Key                               | Type   | Description                          |
| --------------------------------- | ------ | ------------------------------------ |
| `codeblockAutocomplete.enableLanguageAutocomplete` | boolean | Enable the language dropdown for fenced code blocks |
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
