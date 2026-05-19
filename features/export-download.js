/*
 * ChatGPT Conversation Toolkit - Export download helpers
 */
const EXPORT_FILENAME_TITLE_LIMIT = 80;

const sanitizeExportFilenamePart = (value) => {
  const text = typeof value === "string" ? value : "";
  const cleaned = text
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");

  if (!cleaned) {
    return "";
  }

  return Array.from(cleaned).slice(0, EXPORT_FILENAME_TITLE_LIMIT).join("");
};

const getExportDateTag = () => new Date().toISOString().replace(/[:.]/g, "-");

const buildConversationExportFilename = (payload, extension = "json") => {
  const dateTag = getExportDateTag();
  const safeTitle =
    sanitizeExportFilenamePart(payload?.title) ||
    sanitizeExportFilenamePart(payload?.conversationId) ||
    dateTag;
  return `chatgpt-${safeTitle}-${dateTag}.${extension}`;
};

const downloadExportFile = ({ content, filename, mimeType }) => {
  const blob = new Blob([content], {
    type: mimeType || "application/octet-stream",
  });
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const getConversationExportDescriptor = (format = TOOLKIT_EXPORT_FORMAT) => {
  const normalizedFormat = TOOLKIT_EXPORT_FORMAT_VALUES.includes(format)
    ? format
    : TOOLKIT_EXPORT_FORMAT_JSON;

  if (normalizedFormat === TOOLKIT_EXPORT_FORMAT_MARKDOWN) {
    return {
      extension: "md",
      mimeType: "text/markdown;charset=utf-8",
      format: formatConversationExportMarkdown,
    };
  }

  if (normalizedFormat === TOOLKIT_EXPORT_FORMAT_TEXT) {
    return {
      extension: "txt",
      mimeType: "text/plain;charset=utf-8",
      format: formatConversationExportText,
    };
  }

  return {
    extension: "json",
    mimeType: "application/json",
    format: formatConversationExportJson,
  };
};

const downloadConversationExport = (payload, format = TOOLKIT_EXPORT_FORMAT) => {
  const descriptor = getConversationExportDescriptor(format);
  downloadExportFile({
    content: descriptor.format(payload),
    filename: buildConversationExportFilename(payload, descriptor.extension),
    mimeType: descriptor.mimeType,
  });
};

const downloadConversationExportJson = (payload) => {
  downloadConversationExport(payload, TOOLKIT_EXPORT_FORMAT_JSON);
};
