# Codeblock Autocomplete - Architecture Documentation

## Overview

Joplin plugin that provides language autocompletion when typing ` ``` ` in the markdown editor. Shows a dropdown of configured languages and inserts a complete fenced code block. Supports 3+ backticks for nested code blocks, custom languages not in settings, and indentation matching.

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
3. **User Types ` ``` `**: `EditorView.updateListener` detects pattern, triggers `startCompletion()`
4. **Completion Request**: `codeBlockCompleter` fetches languages via `postMessage`, builds options
5. **Selection**: User picks language, `apply` function inserts complete code block

### Key Components

**`settings.ts`**

- Registers `codeblockAutocomplete.languages` setting (comma-separated string)
- Maintains `settingsCache` for sync access
- `getLanguageList()` parses setting into string array

**`codeMirror6Plugin.ts`**

- `fetchLanguages()` - Gets languages from main process via `postMessage`
- `parseOpeningFence()` - Parses current line to extract indent, backtick count (3+), and typed language
- `createApplyFunction()` - Creates completion handler that inserts remaining language text and closing fence from cursor position
- `codeBlockCompleter` - Async completion source that parses fence, filters languages, and adds custom language option if needed
- `triggerCompletionOnBackticks` - Update listener that auto-triggers completion on ` ``` ` when preceded by whitespace only

**`types.ts`**

- `PluginContext` - Joplin content script context with `postMessage`
- `JoplinCodeMirror` - CM wrapper with `joplinExtensions.completionSource`

## Settings

| Key                               | Type   | Description                          |
| --------------------------------- | ------ | ------------------------------------ |
| `codeblockAutocomplete.languages` | string | Comma-separated language identifiers |

Default languages: javascript, typescript, python, bash, shell, html, css, sql, json, xml, yaml, markdown, c, cpp, csharp, java, go, rust, php, ruby, swift, kotlin

## Completion Behavior

- Triggers only when ` ``` ` is preceded by whitespace on the line
- First option is always ` ``` ` (empty code block)
- Configured language options follow, filtered by typed prefix (e.g., ` ```py ` shows python)
- Custom languages not in settings are added with lower priority (e.g., ` ```bobo ` adds "bobo")
- Closing fence matches opening backtick count (e.g., 4 backticks close with 4) and indentation
- Selection inserts remaining language text and closing fence from cursor position, cursor positioned inside block
