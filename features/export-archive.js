/* Sequential, backpressured ZIP export. Images are never embedded as base64. */
const EXPORT_MEMORY_ARCHIVE_LIMIT = 64 * 1024 * 1024;
const EXPORT_PREVIEW_STORE_LIMIT = 32 * 1024 * 1024;
const EXPORT_ZIP_LIMIT = 2 * 1024 * 1024 * 1024;
// How many images may download at the same time. The ZIP writer stays serial;
// only the network fetches overlap.
const EXPORT_IMAGE_CONCURRENCY = 2;

const createExportArchiveSink = async (filename) => {
  // Use the browser download manager, preserving its directory and download history.
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
  // Downloads used to run one by one, so a 40-turn conversation with a dozen
  // images spent most of its time waiting on the network. Fetches now run in
  // small parallel batches; the ZIP writer still receives them strictly in
  // order, so the archive layout stays deterministic.
  const imageGroups = new Map();
  for (const image of images) {
    if (!imageGroups.has(image.source)) imageGroups.set(image.source, []);
    imageGroups.get(image.source).push(image);
  }
  const uniqueImages = [...imageGroups.keys()].map((source) => imageGroups.get(source)[0]);
  const total = uniqueImages.length;
  const startedAt = Date.now();
  let blocked = null;
  let completed = 0;
  const assignToGroup = (source, value) => {
    for (const image of imageGroups.get(source) || []) Object.assign(image, value);
  };
  const markFailed = (source, error) => {
    const failed = {
      status: "failed",
      error: error.name === "AbortError" ? "Image download timed out" : error.message,
    };
    assets.set(source, failed);
    assignToGroup(source, failed);
  };
  try {
    if (options.format === "png") store = await createExportPreviewStore();
    updateStatusByKey("exportImages.progress", "info", { current: 0, total });
    options.onProgress?.({ completed: 0, total, startedAt });
    for (let offset = 0; offset < uniqueImages.length; offset += EXPORT_IMAGE_CONCURRENCY) {
      throwIfExportAborted(signal);
      if (blocked) break;
      const chunk = uniqueImages.slice(offset, offset + EXPORT_IMAGE_CONCURRENCY);
      const fetched = await Promise.all(
        chunk.map(async (image) => {
          try {
            if (blocked) return { image, error: blocked };
            return { image, blob: await fetchExportImage(image, payload, signal) };
          } catch (error) {
            if (error.stopImageRequests) blocked = error;
            return { image, error };
          }
        }),
      );
      for (const result of fetched) {
        throwIfExportAborted(signal);
        const { image } = result;
        if (result.error) {
          if (result.error.stopImageRequests) blocked = result.error;
          markFailed(image.source, result.error);
        } else {
          const blob = result.blob;
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
          assignToGroup(image.source, saved);
        }
        completed += 1;
        updateStatusByKey("exportImages.progress", "info", { current: completed, total });
        options.onProgress?.({ completed, total, startedAt });
      }
    }
    // Once the server refuses images, the rest fail fast instead of hammering it.
    for (const image of uniqueImages) {
      if (assets.has(image.source)) continue;
      markFailed(image.source, blocked || new Error("Image download skipped"));
      completed += 1;
      updateStatusByKey("exportImages.progress", "info", { current: completed, total });
      options.onProgress?.({ completed, total, startedAt });
    }
    options.onProgress?.(null);
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
    // Preserve the selected format; images and the manifest accompany it.
    const formats = { md: formatConversationExportMarkdown, json: formatConversationExportJson, txt: formatConversationExportText };
    if (options.format !== "png") {
      const format = formats[options.format] ? options.format : "json";
      await zip.add(`conversation.${format}`, new Blob([formats[format](payload)]));
    }
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
        payload.completeness === "partial" || failed.length || previewUnavailable
          ? "partial"
          : "complete",
      source: payload.source || "conversation-api",
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
    options.onProgress?.(null);
    delete payload.__imageStore;
    assets.clear();
    await store?.close();
  }
};
