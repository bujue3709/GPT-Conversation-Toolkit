# Offline image export and resource limits

By default, image files are not packaged. In the export dialog, under **Images in selected messages**, choose **Package these images** to package images found in messages included in this export; images from unselected messages are not added. When enabled and selected messages contain images, export produces a ZIP containing the selected conversation format (`conversation.md`, `conversation.json`, or `conversation.txt`), plus `images/` and `manifest.json`. PNG produces paginated images under `pages/` without extra Markdown or JSON conversation files. Markdown references the original files by relative path, so the extracted archive can be viewed offline. With the option disabled, the selected export format is preserved without packaging image files. Single-page PNG downloads as a PNG; multiple pages are packaged in one ZIP, even when image packaging is disabled.

The active conversation branch, selected turns and assistant-only filter determine which messages' images may be packaged. Uploaded images, image-only replies, image asset pointers, visible tool-generated images and inline Markdown image links in those messages are supported. Code examples containing image syntax remain code. DOM fallback can preserve images in loaded and legacy-collapsed messages, but cannot recover messages or resources that the page/API no longer provides. Image references within a message retain their order; DOM fallback appends images after the available text.

Each unique source is downloaded once per export. Original bytes are preserved. A missing, expired, inaccessible or oversized image leaves a readable placeholder and an explicit failure in `manifest.json`; the text export still completes. The archive's image completeness is separate from the conversation's API/DOM completeness. CORS restrictions are respected; there are no new host permissions, background uploads or remote libraries. Signed image URLs and authentication tokens are not included in the image metadata. Existing text supplied by the user is preserved.

## Memory and storage

- Text extraction traverses text nodes without cloning image/resource elements.
- Passive network capture only inspects JSON conversation endpoints, with at most two captures at a time, a combined 20 MiB streamed-body budget and a 15-second deadline. Excess concurrent responses are skipped before cloning; capture is best effort. Event streams are not cloned. The original ChatGPT response remains readable when a capture is skipped or cancelled.
- Captured conversations retain at most 20 entries and a 32 MiB serialized UTF-16 size budget across both indexes. This is an accounting budget, not a measurement of total JavaScript heap. Eviction affects only this optional cache; explicit export/API loading remains available.
- Image downloads run in batches of at most two, limited to 25 MiB per image and 30 seconds per request. ZIP writing uses 64 KiB chunks and awaits the destination before producing more data. The ZIP limit is 2 GiB / 60,000 entries; images are stored without recompression.
- All exports use the browser download manager and follow its download-directory and prompt settings. ZIP downloads use a bounded 64 MiB Blob buffer and fail clearly above that limit; select fewer turns and download in batches. No save-file picker is invoked.
- PNG originals are staged in a temporary OPFS directory and removed at completion/cancellation. Without OPFS, preview staging has a 32 MiB limit; originals still remain in the archive when a preview cannot be staged. Abandoned folders belonging to this exporter are removed on the next PNG export after 24 hours.
- PNG layout preserves aspect ratio and fits a tall image within a page. Only one bitmap is decoded at a time and one large canvas is alive per page; bitmaps and canvases are released after use. Encoded PNG/JPEG/GIF/WebP dimensions are checked before decode, with a 16-megapixel preview limit. Other original image formats can still be archived, but unsupported/oversized/failed previews are explicitly reported. Animated images use a static preview in PNG output.
- Closing the export dialog cancels the active job and preparation request, then releases prepared messages. Cancellation aborts an incomplete ZIP instead of presenting it as a successful archive.

These changes address extension-owned resource amplification and retained data. They do not impose a memory limit on ChatGPT itself or fix unrelated browser bugs. Browser extension activity logging can still accumulate ordinary activity over time.

## Export JSON additions

The existing schema version and text/attachment fields remain compatible. Image-aware messages additionally contain `images` and ordered `content` entries:

```json
{
  "index": 1,
  "role": "assistant",
  "text": "Here is the chart.",
  "images": [{ "id": "image-1", "name": "Chart", "status": "saved", "path": "images/image-0001.png", "mimeType": "image/png", "size": 1234 }],
  "content": [{ "type": "text", "text": "Here is the chart." }, { "type": "image", "imageId": "image-1" }]
}
```

`imageId` is local to its message. `manifest.json` includes the message index, deduplicated asset count, image failures and PNG preview failures. Source references are non-enumerable runtime properties and are not part of this JSON interface. The local extension index cache explicitly persists those references so cached images remain downloadable after a reload; restoration makes them non-enumerable again. Cached signed URLs can expire. No user-settings migration is required; the new `exportImages` preference defaults to disabled and is saved with the existing configuration.

## Development and validation

Requires Node.js 22.15 or later. Run `npm ci`, `npm test`, and `npm run test:browser`. The browser suite loads the actual unpacked extension in an isolated Edge profile on Windows; other platforms default to Playwright Chromium (`npx playwright install chromium`). Set `TOOLKIT_BROWSER` to override the channel. All conversation/API/image data are synthetic, and external requests are intercepted; no ChatGPT login is needed. Browser results and generated archives are written under ignored `output/browser/`.

`npm run vendor` copies the pinned fflate 0.8.2 browser bundle and its MIT license into `vendor/`. The extension uses the bundled file and does not fetch code at runtime. `npm run package` creates an installable ZIP containing extension runtime files and documentation, excluding diagnostics, test profiles and dependencies.

Tests cover the existing PNG/folder/timeline regressions plus image-only messages, tool images, selection, Markdown ordering/code examples, original bytes, missing images, stream limits, cancellation, cache eviction and ZIP backpressure. Browser tests exercise the actual extension UI, PNG pixel output, legacy search/collapse/timeline/Prompt behavior, temporary-file cleanup and ten repeated PNG export jobs. These controlled tests do not establish compatibility with every live ChatGPT API rollout or prove permanent elimination of Edge crashes.

The export dialog shows current progress and elapsed time. After the first unique image completes, an approximate remaining download time is calculated from observed throughput; rendering and packaging are separate stages. Image authentication denials, HTTP 429 and explicit Cloudflare challenges stop later download batches; already-started requests in the bounded batch may finish. Conversation reads distinguish an ordinary endpoint refusal from an explicit challenge and only try current-origin fallback endpoints. Missing images remain recorded in the partial archive. This does not establish the cause of unrelated ChatGPT project-permission errors.

## Timeline and passive capture

Timeline counts refer to user turns, including image-only turns. Live user turns extend the current API index only after an identified final user turn; a divergent or incomplete window shows a `+` count with an explanatory tooltip rather than merging branches. Newly indexed turns remain counted after their DOM nodes are virtualized away. Viewport matching builds one map of mounted message IDs per measurement instead of resolving every historical item against the whole page. Known message IDs never fall back to fuzzy text or row-position matches; unavailable targets report a failure instead of claiming an exact jump. Capture notifications reuse the captured response and do not initiate new API requests. These changes are validated with synthetic fixtures; current ChatGPT virtualization variants and reported post-export send failures still require live-account confirmation.


The branch index is also saved in `chrome.storage.local`: at most three conversations, each at most 2 MiB of serialized UTF-16 content. Cache storage includes conversation text and image source references locally; exported files omit private image sources. Search Range highlights do not alter React-owned text nodes; browsers without Custom Highlight support retain message-level outlining. SPA navigation uses cross-world Navigation API notifications, with MAIN-world history notifications as a fallback. Bridge messages check source, origin and expected shape; this does not authenticate scripts already running in the same page.
