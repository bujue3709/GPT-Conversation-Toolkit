# ChatGPT Conversation Toolkit

[简体中文](./README.md) | English

A browser extension for `ChatGPT Web` focused on making long conversations easier to work with. It improves day-to-day usability with long-conversation cleanup, full-session export, in-page search, a prompt library, timeline navigation, sidebar folder management, and multilingual UI support.

Current active maintainer: `bujue3709` (primary / sole active maintainer)

## ChatGPT Virtualized List Impact (Important)

Recent ChatGPT Web versions use a virtualized list in the conversation area:

- The browser only keeps part of the nearby message DOM mounted.
- Older messages are loaded on demand during scroll and may be unmounted again when far outside the viewport.

Impact on this extension:

- Search and timeline data prefer the API conversation data, so they can cover more of the full conversation.
- Jumping to a target message is still limited by ChatGPT's virtualized list. If the target is not mounted in the DOM, the extension can only try to trigger scroll loading and cannot guarantee a one-click jump.
- In long conversations, if a first/last timeline node or a deep search result does not jump to the target immediately, click it repeatedly so ChatGPT can progressively mount the target area.

## Current Feature Availability (2026-05-19)

Based on current implementation and verified feedback:

- Available: long-conversation cleanup (manual/auto/recover + memory)
- Available: chat export with selectable `.json`, `.txt`, and `.md` formats in Settings
- Available: prompt library (add/delete/search/category/sort/import/export/copy)
- Available: folder management (create/rename/delete/group/sort/drag)
- Available: language switch, theme sync, and draggable toolbar UI
- Available: in-page search (prefers full API conversation data; jump behavior is limited by virtualization and may require repeated clicks)
- Available: timeline navigation (prefers full API user messages; jump behavior is limited by virtualization and may require repeated clicks)

If you need reliable positioning in very long conversations, first scroll near the target range so ChatGPT renders that segment, or click the same search result / timeline node several times while the virtualized list loads more content.

## Supported Sites

- `https://chat.openai.com/*`
- `https://chatgpt.com/*`

## Browser Support

- ✅ `Microsoft Edge` (officially supported)
- ✅ `Google Chrome` (officially supported)
- ⚠️ `Firefox` (temporary loading works; full support hardening is planned)
- ⚠️ `Safari (macOS)` (under evaluation)

## Feature Highlights

- Long conversation cleanup: hide older messages, keep only the latest part visible, remember auto-optimization per conversation, and re-optimize automatically as the visible message count grows.
- Full export: export the current conversation as `.json`, `.txt`, or `.md`; the format can be selected in Settings.
- In-page search: search within the current conversation, highlight matches, and jump between results. Deep-message jumps are limited by ChatGPT virtualization and may require repeated clicks.
- Prompt library: add, delete, search, categorize, sort, import JSON, export JSON, and copy prompts with one click.
- Settings panel: tweak core preferences locally via a native-style modal, supporting real-time variable tuning and auto-persistence.
- LaTeX formula copy: hover rendered formulas and copy LaTeX source in one click.
- Timeline navigation: generate user-message timeline nodes from API conversation data, preview them, follow viewport activation, and move the timeline panel around. Deep-node jumps are limited by ChatGPT virtualization and may require repeated clicks.
- Conversation folders: manage chat folders above the native “Your chats” list without replacing native conversation nodes.
- Multilingual UI: currently supports Chinese and English, auto-detects the browser language, falls back to English when no match is available, and can be changed manually from the toolbar.
- Theme sync: the toolbar, timeline, prompt modal, and folder UI follow ChatGPT light/dark appearance.
- Draggable floating UI: the minimized toolbar button and timeline can both be dragged.

## Installation

### Chrome

1. Open `chrome://extensions/`
2. Turn on Developer mode
3. Click “Load unpacked”
4. Select the repository root

### Edge

1. Open `edge://extensions/`
2. Turn on Developer mode
3. Click “Load unpacked”
4. Select the repository root

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click “Load Temporary Add-on”
3. Select [manifest.json](./manifest.json) from the repository root

## Screenshot

![Extension UI](./image/image.png)

## How It Works

### Toolbar

After the page loads, the extension shows a floating toolbar in the bottom-right corner.

Available actions:

- Optimize long conversations
- Restore hidden messages
- Export the current conversation
- Open the prompt library
- Show or hide the timeline
- Search messages
- Settings panel
- Change language

When collapsed, the toolbar becomes a floating button. The button can be dragged and snaps to the nearest edge when released.

The toolbar footer also includes two lightweight links:

- `Like it? Star the project ✨`
- `I have an optimization idea to share!`

### Language Support

- On startup, the extension checks the user’s browser language and tries to match it against the built-in UI languages.
- The extension currently ships with:
  - `English`
  - `简体中文`
- If the browser language does not match a supported locale, the UI falls back to `English`.
- The toolbar header includes a language switcher with:
  - `Browser default`
  - `English`
  - `简体中文`
- Manual changes apply immediately across the toolbar, timeline, prompt library, folder UI, and status messages, and the preference is saved locally.

### Long Conversation Cleanup

- “Optimize long conversations” hides older messages and keeps the latest `20` visible.
- Once a conversation is optimized manually, the extension remembers that conversation and auto-optimizes it again the next time you open it.
- Remembered conversations show a small indicator in the toolbar header so the current auto-optimization state is visible.
- If an already optimized conversation grows to `keepLatest + 10` visible messages, the extension automatically runs cleanup again and reduces the visible message count back to `keepLatest`.
- “Restore hidden messages” puts hidden messages back into the page.
- “Restore hidden messages” also clears the remembered auto-optimization state for the current conversation.
- Remembered state is cleared if the conversation is not opened again within `10` days, or if that conversation is archived.
- The restore flow tries to preserve reading position instead of jumping the page back to the top.

### Export

- “Export” downloads the current conversation using the format selected in Settings.
- Available export formats are `.json`, `.txt`, and `.md`; `.json` is the default.
- Export still includes all messages even if the page has already been collapsed.

### Search

- Enter a keyword in the toolbar search box and press Enter, or click the search button.
- Matches are highlighted in the conversation.
- Use previous / next navigation to move between results.
- Search can find deep messages from API conversation data, but ChatGPT Web uses a virtualized list. If the target message is not mounted in the DOM yet, jump may not complete in one click; click previous / next again or retry the result so the page can gradually load the target area.
- If matching messages are currently hidden by long-conversation cleanup, restore them first.

### Timeline

- The timeline sits on the left side of the conversation area.
- It prefers API conversation data to generate user-message nodes, instead of relying only on currently loaded DOM messages.
- The node counter format is `current/total`.
- Hover a node to preview the message.
- Clicking a node attempts to jump to the corresponding message. Because ChatGPT uses a virtualized list, deep nodes and first/last nodes may not reach the target in one click; click the node repeatedly while the page progressively loads the target area.
- The active timeline node follows page scrolling.
- The timeline supports wheel scrolling.
- The timeline panel can be dragged by its header.
- The timeline is off by default and can be toggled from the toolbar.
- If you reach the top of the timeline and there are no more visible messages:
  - it shows `已经没有消息了` when everything is already visible
  - it shows `请恢复隐藏消息` when older messages are still hidden

### Prompt Library

- Open it from the toolbar.
- Supported actions:
  - search by title, category, or content
  - filter by category
  - sort by update time, title, or category
  - add prompts
  - delete prompts
  - import JSON
  - export JSON
  - copy content with one click
- A success toast appears after copying.

### LaTeX Formula Copy

- When you hover a rendered formula, a `Copy LaTeX` button appears near that formula.
- Clicking it copies the formula's LaTeX source (not rendered plain text).
- Copy success/failure is shown in the toolbar status area.
- For `LaTeX` code blocks, use ChatGPT's native copy button on the right side of the block.

### Conversation Folders

- Folder controls appear above the sidebar “Your chats” heading.
- You can create, rename, delete, collapse, and expand folders.
- You can drag ungrouped conversations into a folder.
- You can drag conversations back out to `Ungrouped`.
- Drop targets include:
  - the folder header
  - the conversation area inside a folder
  - blank space inside the visible managed folder segment
- You can drag folder headers to reorder folders.
- Folder management only adds local classification and ordering in the sidebar. It does not replace native conversation nodes, so native rename, archive, and other built-in conversation actions remain available.
- Folder structure, assignments, collapse state, and order are persisted locally and restored after refresh.

### Settings Panel

- Accessed from the toolbar, it provides a native-style sliding modal for extension settings.
- Allows you to select the chat export format:
  - `.json`
  - `.txt`
  - `.md`
- Allows you to select the message reading mode used by some DOM fallback features.
- After clicking "Save", changes apply immediately without a page refresh and automatically persist to local storage.
- The modal natively adapts to the ChatGPT light/dark theme dynamically.

## Support

If this project is useful to you, a GitHub Star is appreciated.

<img src="./image/收款码.jpg" width="250" alt="Support QR code" />

## Project Structure

The extension is split into small modules and loaded in order by `manifest.json`.

```text
core/
  state.js
  i18n.js

features/
  collapse.js
  export.js
  folders.js
  search.js
  latex-copy.js
  timeline.js
  prompt-library.js

ui/
  theme.js
  toolbar.js

utils/
  dom.js
  storage.js

contentScript.js
styles.css
manifest.json
```

## Module Overview

- [core/state.js](./core/state.js)
  Runtime constants, shared state, and base configuration.
- [core/i18n.js](./core/i18n.js)
  UI dictionaries, browser-language detection, language switching, and localized UI refresh.
- [utils/dom.js](./utils/dom.js)
  DOM helpers, message node detection, and shared drag scheduling.
- [utils/storage.js](./utils/storage.js)
  Local persistence for UI state, positions, visibility, and saved data.
- [ui/theme.js](./ui/theme.js)
  ChatGPT theme detection and UI theme synchronization.
- [ui/toolbar.js](./ui/toolbar.js)
  Floating toolbar, minimize button, and related drag interactions.
- [features/collapse.js](./features/collapse.js)
  Long-conversation collapse and restore behavior, per-conversation auto-optimization memory, and continuous re-optimization.
- [features/export.js](./features/export.js)
  Conversation export.
- [features/folders.js](./features/folders.js)
  Sidebar folder management, drag classification, folder sorting, and local restore.
- [features/search.js](./features/search.js)
  Message search and result navigation.
- [features/latex-copy.js](./features/latex-copy.js)
  Hover button for rendered formulas and one-click LaTeX source copy.
- [features/timeline.js](./features/timeline.js)
  Timeline rendering, preview, scrolling, dragging, and active-node synchronization.
- [features/prompt-library.js](./features/prompt-library.js)
  Prompt library CRUD, filtering, copying, import, and export.
- [contentScript.js](./contentScript.js)
  Bootstrap entry point, initialization, and DOM observer wiring.
- [styles.css](./styles.css)
  Styles for the toolbar, timeline, prompt modal, and folder UI.

## Configuration

Common settings live in [core/state.js](./core/state.js).

Example:

```js
const TIMELINE_VISIBLE_NODE_CAPACITY = 10;
const TIMELINE_MAX_NODES = 20;
const COLLAPSE_AUTO_REOPTIMIZE_BUFFER = 10;

const state = {
  isCollapsed: false,
  isMinimized: false,
  keepLatest: 20,
  collapsedNodes: [],
  cachedNodes: [],
};
```

Key fields:

- `keepLatest`: how many latest messages remain visible after long-conversation cleanup
- `COLLAPSE_AUTO_REOPTIMIZE_BUFFER`: how many additional visible messages are allowed before an already optimized conversation is automatically collapsed again
- `TIMELINE_VISIBLE_NODE_CAPACITY`: approximate number of timeline nodes visible in one screenful
- `TIMELINE_MAX_NODES`: maximum sampled timeline node count

## Exported Conversation JSON

```json
{
  "exportedAt": "2026-03-13T08:30:00.000Z",
  "url": "https://chatgpt.com/c/xxxxxxxx",
  "messageCount": 2,
  "messages": [
    {
      "index": 1,
      "role": "user",
      "text": "Your message"
    },
    {
      "index": 2,
      "role": "assistant",
      "text": "ChatGPT response"
    }
  ]
}
```

Field notes:

- `exportedAt`: export timestamp in ISO 8601 format
- `url`: current conversation URL
- `messageCount`: total exported message count
- `messages`: message array
- `messages[].index`: message order
- `messages[].role`: usually `user` or `assistant`
- `messages[].text`: plain text content

## Prompt Library JSON

The prompt library exports as an object:

```json
{
  "version": 1,
  "updatedAt": "2026-03-13T08:30:00.000Z",
  "prompts": [
    {
      "id": "c94f7299-40f3-4f95-a9f7-0ff93029a3f8",
      "title": "Daily Summary",
      "category": "Work",
      "content": "Summarize today’s work by completed items, risks, and next steps.",
      "createdAt": 1741576200000,
      "updatedAt": 1741576200000
    }
  ]
}
```

Field notes:

- `version`: format version, currently `1`
- `updatedAt`: library-level update timestamp
- `prompts`: prompt array
- `prompts[].id`: unique ID
- `prompts[].title`: title
- `prompts[].category`: category
- `prompts[].content`: prompt body
- `prompts[].createdAt`: creation timestamp
- `prompts[].updatedAt`: update timestamp

### Supported Import Shapes

The library supports two import shapes:

#### Object shape

```json
{
  "prompts": [
    {
      "title": "Code Review",
      "category": "Development",
      "content": "List issues by severity and suggest fixes."
    }
  ]
}
```

#### Array shape

```json
[
  {
    "title": "Requirement Breakdown",
    "category": "Product",
    "content": "Break this down into tasks with priorities and acceptance criteria."
  }
]
```

Import rules:

- records with empty `content` are ignored
- empty `title` values are generated from the content
- empty `category` values fall back to `未分类`
- duplicates are removed using `title + category + content`, case-insensitive

## Development Notes

- This project does not use a bundler.
- After changing scripts, reload the extension from the browser extensions page.
- Script execution order is defined by the `content_scripts.js` array in [manifest.json](./manifest.json).

## Known Limitations

- Timeline and search prefer API conversation data, so they can cover more of the full conversation.
- Jumping is still limited by ChatGPT's virtualized list. If the target message is not mounted in the DOM, you may need to repeatedly click the timeline node or search previous/next until the page progressively loads the target area.
- If messages were hidden by cleanup, restore them first before in-page positioning.
- LaTeX copy mainly targets rendered formula nodes. For `LaTeX` code blocks, use ChatGPT's native copy button.
- Folder management depends on the current ChatGPT sidebar DOM structure and stores classification locally. It does not sync to the ChatGPT service.
- ChatGPT DOM changes may require selector updates over time.

## Maintainer

This project is currently maintained by `bujue3709` as the sole active maintainer.

## License

This project is licensed under the [MIT License](./LICENSE).

You are free to use, modify, publish, distribute, and sell copies of the software as allowed by MIT, provided the license notice is kept with the software.

### Non-license Note

Please do not misrepresent the original project name, authorship, or branding. If you distribute a modified or unofficial version, label it clearly. This note is only to prevent confusion and does not add extra license restrictions.
