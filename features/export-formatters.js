/*
 * ChatGPT Conversation Toolkit - Export formatters
 */
const formatConversationExportJson = (payload) => JSON.stringify(payload, null, 2);

const formatExportImageMarkdown = (image) => {
  const alt = String(image?.name || "Image").replace(/[\[\]\\\r\n]/g, " ");
  return image?.path ? `![${alt}](${image.path})` : `[Image unavailable: ${alt}]`;
};

const formatExportMessageWithImages = (message) => {
  const images = message.images || [];
  const content = message.content?.length ? message.content : [
    { type: "text", text: message.__markdown || message.text || "" },
    ...images.map((image) => ({ type: "image", imageId: image.id })),
  ];
  return content.map((part) => part.type === "image"
    ? formatExportImageMarkdown(images.find((image) => image.id === part.imageId))
    : part.text || "").join("\n\n");
};

const formatConversationExportMarkdown = (payload) => {
  const lines = [];
  if (payload?.title) {
    lines.push(`# ${payload.title}`, "");
  }
  if (payload?.completeness === "partial") {
    lines.push(`> ${t("export.partialNotice")}`, "");
  }
  (payload?.messages || []).forEach((message) => {
    const role = message.role ? message.role[0].toUpperCase() + message.role.slice(1) : "Message";
    const text = payload.includeImages && message.images?.length
      ? formatExportMessageWithImages(message)
      : typeof message.markdown === "string" && message.markdown
        ? message.markdown
        : typeof message.__markdown === "string" && message.__markdown
          ? message.__markdown
          : message.text || "";
    lines.push(`## ${role}`, "");
    if (text) {
      lines.push(text, "");
    }
  });
  return lines.join("\n").trimEnd() + "\n";
};

const formatConversationExportText = (payload) => {
  const body = (payload?.messages || [])
    .map((message) => {
      const role = message.role || "message";
      const text = payload.includeImages && message.images?.length
        ? formatExportMessageWithImages(message).replace(/!\[([^\]]*)\]\((images\/[^)]+)\)/g, "[Image: $1] $2")
        : message.text || "";
      return `[${role}]\n${text}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
  if (payload?.completeness !== "partial") {
    return body;
  }
  return [t("export.partialNotice"), "", body].join("\n");
};
