/* Sequential, backpressured ZIP export. Images are never embedded as base64. */
const EXPORT_MEMORY_ARCHIVE_LIMIT = 64 * 1024 * 1024;
const EXPORT_PREVIEW_STORE_LIMIT = 32 * 1024 * 1024;
const EXPORT_ZIP_LIMIT = 2 * 1024 * 1024 * 1024;

const createExportArchiveSink = async (filename) => {
  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "ChatGPT archive",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      return await handle.createWritable();
    } catch (error) {
      if (error.name !== "SecurityError" && error.name !== "NotAllowedError")
        throw error;
      // Browser contexts without file-picker access use a bounded Blob fallback.
    }
  }
  let chunks = [];
  let size = 0;
  return {
    async write(chunk) {
      size += chunk.byteLength;
      if (size > EXPORT_MEMORY_ARCHIVE_LIMIT)
        throw new Error(t("exportImages.memoryLimit"));
      chunks.push(chunk);
    },
    async close() {
      downloadExportFile({
        content: new Blob(chunks),
        filename,
        mimeType: "application/zip",
      });
      chunks = [];
    },
    async abort() {
      chunks = [];
    },
  };
};

const createExportZipWriter = (sink, signal) => {
  let pending = [];
  let failure;
  let bytes = 0;
  let entries = 0;
  const zip = new fflate.Zip((error, chunk) => {
    if (error) failure = error;
    else pending.push(chunk);
  });
  const flush = async () => {
    if (failure) throw failure;
    const chunks = pending;
    pending = [];
    for (const chunk of chunks) {
      throwIfExportAborted(signal);
      bytes += chunk.byteLength;
      if (bytes > EXPORT_ZIP_LIMIT)
        throw new Error("Archive exceeds 2 GiB; export fewer turns");
      await sink.write(chunk);
    }
  };
  return {
    async add(name, blob) {
      if (++entries > 60000) throw new Error("Too many archive entries");
      if (!/^(?:images\/|pages\/)?[A-Za-z0-9._-]+$/.test(name))
        throw new Error("Invalid archive path");
      const entry = new fflate.ZipPassThrough(name);
      zip.add(entry);
      await flush();
      for (let offset = 0; offset < blob.size; offset += 65536) {
        throwIfExportAborted(signal);
        entry.push(
          new Uint8Array(
            await blob.slice(offset, offset + 65536).arrayBuffer(),
          ),
        );
        await flush();
      }
      entry.push(new Uint8Array(), true);
      await flush();
    },
    async close() {
      zip.end();
      await flush();
      await sink.close();
    },
    async abort() {
      zip.terminate();
      pending = [];
      await sink.abort();
    },
  };
};

const createExportPreviewStore = async () => {
  let root, directory, directoryName;
  try {
    root = await navigator.storage.getDirectory();
    // Only remove our own abandoned export folders, never site-owned files.
    for await (const [name] of root.entries()) {
      const match = /^chatgpt-toolkit-export-(\d+)-/.exec(name);
      if (match && Date.now() - Number(match[1]) > 86400000) {
        await root.removeEntry(name, { recursive: true });
      }
    }
    directoryName = `chatgpt-toolkit-export-${Date.now()}-${crypto.randomUUID()}`;
    directory = await root.getDirectoryHandle(directoryName, { create: true });
  } catch {
    directory = null;
  }
  const blobs = new Map();
  let retainedBytes = 0;
  return {
    async put(key, blob) {
      if (directory) {
        const file = await directory.getFileHandle(key, { create: true });
        const writer = await file.createWritable();
        try {
          await writer.write(blob);
          await writer.close();
        } catch (error) {
          await writer.abort().catch(() => {});
          throw error;
        }
      } else {
        if (retainedBytes + blob.size > EXPORT_PREVIEW_STORE_LIMIT)
          throw new Error("Preview storage limit reached");
        blobs.set(key, blob);
        retainedBytes += blob.size;
      }
    },
    async get(key) {
      if (directory) return (await directory.getFileHandle(key)).getFile();
      return blobs.get(key);
    },
    async close() {
      blobs.clear();
      retainedBytes = 0;
      if (directory)
        await root
          .removeEntry(directoryName, { recursive: true })
          .catch(() => {});
    },
  };
};

const getExportImageExtension = (type) =>
  ({
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
    "image/svg+xml": "svg",
    "image/bmp": "bmp",
    "image/x-icon": "ico",
  })[type] || "img";

const exportConversationImageArchive = async (payload, options = {}) => {
  const signal = options.signal;
  const filename = buildConversationExportFilename(payload, "zip");
  const sink = await createExportArchiveSink(filename);
  const zip = createExportZipWriter(sink, signal);
  let store;
  const assets = new Map();
  const images = payload.messages.flatMap((message) => message.images || []);
  try {
    if (options.format === "png") store = await createExportPreviewStore();
    for (let index = 0; index < images.length; index++) {
      const image = images[index];
      throwIfExportAborted(signal);
      updateStatusByKey("exportImages.progress", "info", {
        current: index + 1,
        total: images.length,
      });
      const previous = assets.get(image.source);
      if (previous) {
        Object.assign(image, previous);
        continue;
      }
      let blob;
      try {
        blob = await fetchExportImage(image, payload, signal);
      } catch (error) {
        throwIfExportAborted(signal);
        const failed = {
          status: "failed",
          error:
            error.name === "AbortError"
              ? "Image download timed out"
              : error.message,
        };
        assets.set(image.source, failed);
        Object.assign(image, failed);
        continue;
      }
      const path = `images/image-${String(assets.size + 1).padStart(4, "0")}.${getExportImageExtension(blob.type)}`;
      // ZIP/sink failures are fatal, never misreported as a missing image.
      await zip.add(path, blob);
      const saved = {
        status: "saved",
        path,
        mimeType: blob.type,
        size: blob.size,
      };
      if (store) {
        const dimensions = await getExportImageDimensions(blob);
        if (dimensions) {
          try {
            await store.put(path.slice("images/".length), blob);
            Object.assign(saved, dimensions, { preview: "available" });
          } catch {
            saved.preview = "storage-unavailable";
          }
        } else saved.preview = "unsupported-or-too-large";
      }
      assets.set(image.source, saved);
      Object.assign(image, saved);
    }
    if (options.format === "png") {
      Object.defineProperty(payload, "__imageStore", {
        configurable: true,
        value: store,
      });
      await exportConversationPng(payload, {
        signal,
        usedFallback: options.usedFallback,
        onPage: (blob, index) =>
          zip.add(
            `pages/conversation-${String(index + 1).padStart(3, "0")}.png`,
            blob,
          ),
      });
    }
    // Include a readable and a structured copy in every image archive.
    await zip.add(
      "conversation.md",
      new Blob([formatConversationExportMarkdown(payload)]),
    );
    await zip.add(
      "conversation.json",
      new Blob([formatConversationExportJson(payload)]),
    );
    if (options.format === "txt")
      await zip.add(
        "conversation.txt",
        new Blob([formatConversationExportText(payload)]),
      );
    const failed = images.filter((image) => image.status !== "saved");
    const previewUnavailable =
      options.format === "png"
        ? images.filter((image) => image.preview !== "available").length
        : 0;
    const manifest = {
      version: 1,
      imageCount: images.length,
      uniqueImageCount: assets.size,
      failedImageCount: failed.length,
      previewUnavailableCount: previewUnavailable,
      completeness:
        failed.length || previewUnavailable ? "partial" : "complete",
      images: payload.messages.flatMap((message) =>
        (message.images || []).map((image) => ({
          messageIndex: message.index,
          ...image,
        })),
      ),
    };
    await zip.add(
      "manifest.json",
      new Blob([JSON.stringify(manifest, null, 2)]),
    );
    await zip.close();
    updateStatusByKey(
      failed.length || previewUnavailable
        ? "exportImages.partial"
        : "exportImages.done",
      failed.length || previewUnavailable ? "warn" : "success",
      {
        count: images.length - failed.length,
        failed: failed.length,
        previews: previewUnavailable,
      },
    );
    return payload;
  } catch (error) {
    await zip.abort().catch(() => {});
    throw error;
  } finally {
    delete payload.__imageStore;
    assets.clear();
    await store?.close();
  }
};
