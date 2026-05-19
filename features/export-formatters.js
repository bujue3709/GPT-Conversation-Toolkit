/*
 * ChatGPT Conversation Toolkit - Export formatters
 */
const formatConversationExportJson = (payload) => JSON.stringify(payload, null, 2);

const formatConversationExportMarkdown = (payload) => {
  const lines = [];
  if (payload?.title) {
    lines.push(`# ${payload.title}`, "");
  }
  (payload?.messages || []).forEach((message) => {
    const role = message.role ? message.role[0].toUpperCase() + message.role.slice(1) : "Message";
    const text =
      payload?.source === "api" && typeof message.__markdown === "string"
        ? message.__markdown
        : message.text || "";
    lines.push(`## ${role}`, "");
    if (text) {
      lines.push(text, "");
    }
  });
  return lines.join("\n").trimEnd() + "\n";
};

const formatConversationExportText = (payload) =>
  (payload?.messages || [])
    .map((message) => {
      const role = message.role || "message";
      return `[${role}]\n${message.text || ""}`.trim();
    })
    .filter(Boolean)
    .join("\n\n");
