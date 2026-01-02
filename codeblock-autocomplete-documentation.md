# Codeblock Autocomplete - Architecture Documentation

## Overview

Joplin plugin that provides language autocompletion when typing ` ``` ` or `~~~` in the markdown editor. Shows a dropdown of configured languages and inserts a complete fenced code block. Supports both backtick and tilde fences, 3+ fence characters for nested code blocks, custom languages not in settings, and indentation matching.

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
3. **User Types ` ``` ` or `~~~`**: `EditorView.updateListener` detects pattern, triggers `startCompletion()`
4. **Completion Request**: `codeBlockCompleter` fetches languages via `postMessage`, builds options
5. **Selection**: User picks language, `apply` function inserts complete code block

### Key Components

**`settings.ts`**

- Registers `codeblockAutocomplete.languages` setting (comma-separated string)
- Maintains `settingsCache` for sync access
- `getLanguageList()` parses setting into string array

**`codeMirror6Plugin.ts`**

- `parseOpeningFence()` - Parses current line to extract indent, fence character (`` ` `` or `~`), fence count (3+), typed language, and language start position
- `createApplyFunction()` - Creates completion handler that replaces typed language and inserts closing fence with matching character
- `codeBlockCompleter` - Async completion source that parses fence, filters languages case-insensitively, returns matched languages before custom language option
- `triggerCompletionOnFence` - Update listener that auto-triggers completion on ` ``` ` or `~~~` when preceded by whitespace only

**`types.ts`**

- `PluginContext` - Joplin content script context with `postMessage`
- `JoplinCodeMirror` - CM wrapper with `joplinExtensions.completionSource`

## Settings

| Key                               | Type   | Description                          |
| --------------------------------- | ------ | ------------------------------------ |
| `codeblockAutocomplete.languages` | string | Comma-separated language identifiers |

Default languages: javascript, typescript, python, bash, shell, html, css, sql, json, xml, yaml, markdown, c, cpp, csharp, java, go, rust, php, ruby, swift, kotlin

## Completion Behavior

- Triggers on both backtick (` ``` `) and tilde (`~~~`) fences when preceded by whitespace on the line
- First option is always `No language` when no language typed
- Configured language options follow, filtered case-insensitively by typed prefix (e.g., ` ```py ` shows python)
- Supports language names with hyphens and special characters (e.g., `objective-c`, `c++`)
- Custom languages not in settings appear after all matched languages (e.g., typing ` ```bobo ` adds "bobo" below any matches)
- Closing fence matches opening fence character and count (e.g., `~~~~` closes with `~~~~`, ``` ```` ``` closes with ``` ```` ```) and indentation
- Selection replaces typed language and inserts closing fence, cursor positioned inside block
