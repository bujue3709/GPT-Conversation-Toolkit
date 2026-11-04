/* Image references stay lightweight until the user starts an export. */
const EXPORT_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const EXPORT_IMAGE_MAX_PIXELS = 16 * 1024 * 1024;

const makeExportImage = (source, options = {}) => {
  const image = {
    id: options.id || `image-${options.index || 1}`,
    name: options.name || "Image",
  };
  Object.defineProperty(image, "source", { value: source, enumerable: false });
  Object.defineProperty(image, "messageId", {
    value: options.messageId || "",
    enumerable: false,
  });
  return image;
};

const cloneExportImage = (image) =>
  Object.assign(makeExportImage(image.source, image), image);

const splitExportMarkdownImages = (text, addText, addImage) => {
  let start = 0,
    offset = 0,
    fence = null;
  while (offset < text.length) {
    if (offset === 0 || text[offset - 1] === "\n") {
      const marker = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(
        text.slice(offset),
      );
      if (marker) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length)
          fence = null;
        offset += marker[0].length;
        continue;
      }
    }
    if (fence) {
      offset++;
      continue;
    }
    if (text[offset] === "\\") {
      offset += 2;
      continue;
    }
    if (text[offset] === "`") {
      const ticks = /^`+/.exec(text.slice(offset))[0];
      const end = text.indexOf(ticks, offset + ticks.length);
      offset = end < 0 ? offset + ticks.length : end + ticks.length;
      continue;
    }
    if (!text.startsWith("![", offset)) {
      offset++;
      continue;
    }
    const alt = /^!\[((?:\\.|[^\]\\\n])*)\]\(/.exec(text.slice(offset));
    if (!alt) {
      offset++;
      continue;
    }
    const destinationStart = offset + alt[0].length;
    let end = destinationStart,
      depth = 1,
      quoted = false;
    for (; end < text.length; end++) {
      if (text[end] === "\\") {
        end++;
        continue;
      }
      if (text[end] === "<") quoted = true;
      else if (text[end] === ">") quoted = false;
      if (quoted) continue;
      if (text[end] === "(") depth++;
      if (text[end] === ")" && --depth === 0) break;
    }
    if (depth !== 0) {
      offset++;
      continue;
    }
    const destination = text.slice(destinationStart, end).trim();
    const match = /^(<[^>]+>|[^\s]+?)(?:\s+["'][^"']*["'])?$/.exec(destination);
    const url = match?.[1]?.replace(/^<|>$/g, "").replace(/\\([()\\])/g, "$1");
    if (
      !url ||
      !/^(https?:|sandbox:|sediment:|file-service:|data:image\/|blob:)/i.test(
        url,
      )
    ) {
      offset = end + 1;
      continue;
    }
    if (offset > start) addText(text.slice(start, offset));
    addImage(url, alt[1] || "Image");
    start = end + 1;
    offset = start;
  }
  if (start < text.length) addText(text.slice(start));
};

// Internal asset URLs are not useful offline. Keep code examples intact by
// using the same Markdown scanner as image collection.
const stripInternalExportImageLinks = (text) => {
  const pieces = [];
  splitExportMarkdownImages(text || "", (value) => pieces.push(value), (url, alt) => {
    pieces.push(/^(sediment:|file-service:|sandbox:)/i.test(url)
      ? `[Image: ${alt}]` : `![${alt}](${url})`);
  });
  return pieces.join("");
};

const collectExportImageContent = (message) => {
  const images = [];
  const content = [];
  const addImage = (source, name = "Image") => {
    if (typeof source !== "string" || !source) return;
    let image = images.find((item) => item.source === source);
    if (!image) {
      image = makeExportImage(source, {
        id: `image-${images.length + 1}`,
        name,
        messageId: message?.id,
      });
      images.push(image);
    }
    content.push({ type: "image", imageId: image.id });
  };
  const addText = (text) => {
    splitExportMarkdownImages(
      text,
      (value) => content.push({ type: "text", text: value }),
      addImage,
    );
  };
  const visit = (part, depth = 0) => {
    if (depth > 8) return;
    if (typeof part === "string") {
      addText(part);
      return;
    }
    if (!part || typeof part !== "object") return;
    const kind = part.content_type || part.type || "";
    if (
      kind === "image_asset_pointer" ||
      kind === "image_url" ||
      kind === "image"
    ) {
      addImage(
        part.asset_pointer || part.image_url?.url || part.image_url || part.url,
        part.name,
      );
      return;
    }
    if (typeof part.text === "string") addText(part.text);
    else if (Array.isArray(part.parts))
      part.parts.forEach((child) => visit(child, depth + 1));
    else if (Array.isArray(part.content))
      part.content.forEach((child) => visit(child, depth + 1));
  };
  const raw = message?.content;
  (Array.isArray(raw?.parts)
    ? raw.parts
    : typeof raw?.text === "string"
      ? [raw.text]
      : []
  ).forEach((p) => visit(p));
  const metadata = message?.metadata || {};
  [metadata.attachments, metadata.files, metadata.uploaded_files].forEach(
    (items) => {
      (Array.isArray(items) ? items : []).forEach((item) => {
        if (/^image\//i.test(item?.mime_type || item?.mimeType || "")) {
          const ref = item.asset_pointer || item.file_id || item.id;
          if (
            ref &&
            !images.some(
              (image) =>
                image.source.replace(/^(sediment|file-service):\/\//, "") ===
                ref,
            )
          ) {
            addImage(ref, item.name || item.file_name);
          }
        }
      });
    },
  );
  (metadata.aggregate_result?.messages || []).forEach((item) => {
    if (item?.message_type === "image") addImage(item.image_url, item.name);
  });
  return { images, content };
};

const collectDomExportImages = (node) => {
  const images = [];
  if (!(node instanceof HTMLElement)) return images;
  getMessageTextContainers(node).forEach((container) => {
    container.querySelectorAll("img").forEach((element) => {
      const hidden = element.closest("button, [aria-hidden='true'], .sr-only");
      if (hidden && hidden !== container && container.contains(hidden)) return;
      const source = element.currentSrc || element.getAttribute("src");
      if (!source || images.some((image) => image.source === source)) return;
      images.push(
        makeExportImage(source, {
          index: images.length + 1,
          name: element.alt || "Image",
        }),
      );
    });
  });
  return images;
};

const throwIfExportAborted = (signal) => {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
};

const checkExportImageAccess = (response) => {
  if ([401, 403, 429].includes(response.status) || response.headers.get("cf-mitigated") === "challenge") {
    const error = new Error(t("exportImages.blocked", { status: response.status }));
    error.stopImageRequests = true;
    throw error;
  }
};

const readExportImageResponse = async (response, signal) => {
  checkExportImageAccess(response);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const type = (response.headers.get("content-type") || "")
    .split(";")[0]
    .toLowerCase();
  if (type && !type.startsWith("image/") && type !== "application/octet-stream")
    throw new Error("Response is not an image");
  if (Number(response.headers.get("content-length")) > EXPORT_IMAGE_MAX_BYTES)
    throw new Error("Image exceeds 25 MiB");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Streaming response is unavailable");
  const chunks = [];
  let size = 0;
  let complete = false;
  try {
    while (true) {
      throwIfExportAborted(signal);
      const { value, done } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > EXPORT_IMAGE_MAX_BYTES)
        throw new Error("Image exceeds 25 MiB");
      chunks.push(value);
    }
    let blob = new Blob(chunks, { type });
    if (!type.startsWith("image/")) {
      const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
      const text = String.fromCharCode(...head);
      const detected =
        text.slice(1, 4) === "PNG"
          ? "image/png"
          : head[0] === 0xff && head[1] === 0xd8
            ? "image/jpeg"
            : text.startsWith("GIF8")
              ? "image/gif"
              : text.startsWith("RIFF") && text.slice(8, 12) === "WEBP"
                ? "image/webp"
                : text.slice(4, 12) === "ftypavif"
                  ? "image/avif"
                  : "";
      if (!detected) throw new Error("Response is not a recognized image");
      blob = new Blob([blob], { type: detected });
    }
    return blob;
  } finally {
    if (!complete) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
};

const resolveExportImageUrl = async (image, payload, signal) => {
  const source = image.source || "";
  if (/^(https?:|blob:|data:image\/)/i.test(source)) return source;
  let apiUrl;
  if (source.startsWith("sandbox:")) {
    if (!payload.conversationId || !image.messageId)
      throw new Error("Missing image message reference");
    apiUrl = new URL(
      `/backend-api/conversation/${encodeURIComponent(payload.conversationId)}/interpreter/download`,
      window.location.origin,
    );
    apiUrl.searchParams.set("message_id", image.messageId);
    apiUrl.searchParams.set("sandbox_path", source.slice("sandbox:".length));
  } else {
    const id = source.replace(/^(sediment|file-service):\/\//, "");
    if (!/^file[-_][A-Za-z0-9_-]+$/.test(id))
      throw new Error("Unsupported image reference");
    apiUrl = new URL(
      `/backend-api/files/download/${encodeURIComponent(id)}`,
      window.location.origin,
    );
  }
  throwIfExportAborted(signal);
  const headers = await getAuthenticatedExportApiHeaders(apiUrl.toString());
  const response = await fetch(apiUrl, {
    headers,
    credentials: "include",
    signal,
  });
  checkExportImageAccess(response);
  if (!response.ok) throw new Error(`Image resolver HTTP ${response.status}`);
  const data = await response.json();
  const url = new URL(data.download_url || "");
  if (url.protocol !== "https:") throw new Error("Invalid image download URL");
  return url.toString();
};

const fetchExportImage = async (image, payload, signal) => {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, 30000);
  try {
    throwIfExportAborted(signal);
    const url = await resolveExportImageUrl(image, payload, controller.signal);
    // The ChatGPT bearer token is used only by the same-origin resolver above.
    // Never forward it to the CDN or to a Markdown image URL.
    const response = await fetch(url, {
      signal: controller.signal,
      credentials:
        new URL(url, window.location.href).origin === window.location.origin
          ? "include"
          : "omit",
    });
    return await readExportImageResponse(response, controller.signal);
  } catch (error) {
    if (error.code === "ACCESS_BLOCKED") error.stopImageRequests = true;
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
};

const getExportImageDimensions = async (blob) => {
  // Inspect encoded dimensions before decoding, so a tiny compressed image
  // cannot cause an unbounded bitmap allocation. Unknown formats stay archived.
  const bytes = new Uint8Array(await blob.slice(0, 256 * 1024).arrayBuffer());
  const view = new DataView(bytes.buffer);
  const ascii = (start, count) =>
    String.fromCharCode(...bytes.slice(start, start + count));
  let width = 0,
    height = 0;
  if (bytes.length >= 24 && ascii(1, 3) === "PNG") {
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (bytes.length >= 10 && ascii(0, 3) === "GIF") {
    width = view.getUint16(6, true);
    height = view.getUint16(8, true);
  } else if (
    bytes.length >= 30 &&
    ascii(0, 4) === "RIFF" &&
    ascii(8, 4) === "WEBP"
  ) {
    const kind = ascii(12, 4);
    if (kind === "VP8X") {
      width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16);
      height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
    } else if (kind === "VP8 ") {
      width = view.getUint16(26, true) & 0x3fff;
      height = view.getUint16(28, true) & 0x3fff;
    } else if (kind === "VP8L" && bytes[20] === 0x2f) {
      const bits = view.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >>> 14) & 0x3fff) + 1;
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        height = view.getUint16(offset + 5);
        width = view.getUint16(offset + 7);
        break;
      }
      offset += 2 + length;
    }
  }
  if (!width || !height || width * height > EXPORT_IMAGE_MAX_PIXELS)
    return null;
  return { width, height };
};
