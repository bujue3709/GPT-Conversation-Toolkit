/*
 * ChatGPT Conversation Toolkit - Export normalization
 */
const EXPORT_SCHEMA_VERSION = 1;
const EXPORT_BRANCH_MODE_ACTIVE = "active";
const EXPORT_SCOPE_ALL = "all";
const EXPORT_SCOPE_SELECTED = "selected";

const cloneExportJsonValue = (value) => {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
};

const normalizeExportTimestamp = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value > 100000000000 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toISOString();
  }
  return null;
};

const uniqueExportWarnings = (warnings) =>
  Array.from(new Set((Array.isArray(warnings) ? warnings : []).filter(Boolean)));

const normalizeExportMessageText = (value) => {
  const text = typeof value === "string" ? value : "";
  return text
    .replace(/\s*(展开收起|展开|收起|Show more|Show less|Expand|Collapse)\s*$/gi, "")
    .trim();
};

const normalizeExportMarkdownText = (value) =>
  typeof value === "string"
    ? value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
    : "";

const normalizeExportAttachment = (attachment, index) => {
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const normalized = {
    index: index + 1,
  };

  if (attachment.name) {
    normalized.name = attachment.name;
  }
  if (attachment.id) {
    normalized.id = attachment.id;
  }
  if (attachment.mimeType) {
    normalized.mimeType = attachment.mimeType;
  }
  return Object.keys(normalized).length > 1 ? normalized : null;
};

const normalizeExportMessage = (message, index) => {
  const normalized = {
    index: Number.isFinite(message?.index) ? message.index : index + 1,
    role: typeof message?.role === "string" && message.role ? message.role : "unknown",
    text: normalizeExportMessageText(message?.text || ""),
  };

  const attachments = Array.isArray(message?.attachments)
    ? message.attachments
        .map((attachment, attachmentIndex) => normalizeExportAttachment(attachment, attachmentIndex))
        .filter(Boolean)
    : [];
  if (attachments.length > 0) {
    normalized.attachments = attachments;
  }

  const markdown = normalizeExportMarkdownText(message?.markdown || "");
  if (markdown) {
    Object.defineProperty(normalized, "__markdown", {
      configurable: true,
      enumerable: false,
      value: markdown,
    });
  }

  return normalized;
};

const normalizeExportMessages = (messages) => {
  const normalizedMessages = [];
  (Array.isArray(messages) ? messages : []).forEach((message, index) => {
    const normalized = normalizeExportMessage(message, index);
    if (!normalized.text && !(Array.isArray(normalized.attachments) && normalized.attachments.length > 0)) {
      return;
    }
    normalized.index = normalizedMessages.length + 1;
    normalizedMessages.push(normalized);
  });
  return normalizedMessages;
};

const groupExportMessagesIntoTurns = (messages) => {
  const turns = [];
  let currentTurn = null;

  (Array.isArray(messages) ? messages : []).forEach((message, messageOffset) => {
    const role = message?.role || "unknown";
    if (role === "user" || !currentTurn) {
      currentTurn = {
        id: `turn-${turns.length + 1}`,
        order: turns.length + 1,
        messages: [],
        userMessages: [],
        assistantMessages: [],
      };
      turns.push(currentTurn);
    }

    const sourceIndex = Number.isFinite(message?.sourceIndex)
      ? message.sourceIndex
      : Number.isFinite(message?.index)
        ? message.index
        : messageOffset + 1;
    const turnMessage = { message, sourceIndex };
    currentTurn.messages.push(turnMessage);
    if (role === "user") {
      currentTurn.userMessages.push(turnMessage);
    } else if (role === "assistant") {
      currentTurn.assistantMessages.push(turnMessage);
    }
  });

  return turns;
};

const cloneExportMessageForSelection = (message, index, sourceIndex, includeSourceIndex) => {
  const cloned = {
    ...(message || {}),
    index,
  };
  if (includeSourceIndex) {
    cloned.sourceIndex = sourceIndex;
  }
  if (typeof message?.__markdown === "string") {
    Object.defineProperty(cloned, "__markdown", {
      configurable: true,
      enumerable: false,
      value: message.__markdown,
    });
  }
  return cloned;
};

const applyExportSelection = (payload, options = {}) => {
  const sourceMessages = Array.isArray(payload?.messages) ? payload.messages : [];
  const turns = groupExportMessagesIntoTurns(sourceMessages);
  const scope = options.scope === EXPORT_SCOPE_SELECTED
    ? EXPORT_SCOPE_SELECTED
    : EXPORT_SCOPE_ALL;
  const roleFilter = options.roleFilter === TOOLKIT_EXPORT_ROLE_ASSISTANT
    ? TOOLKIT_EXPORT_ROLE_ASSISTANT
    : TOOLKIT_EXPORT_ROLE_ALL;
  const selectedTurnIds = new Set(
    Array.isArray(options.selectedTurnIds)
      ? options.selectedTurnIds.map((turnId) => String(turnId))
      : [],
  );
  const includedTurns = scope === EXPORT_SCOPE_SELECTED
    ? turns.filter((turn) => selectedTurnIds.has(turn.id))
    : turns;
  const includeSourceIndex =
    scope === EXPORT_SCOPE_SELECTED || roleFilter === TOOLKIT_EXPORT_ROLE_ASSISTANT;
  const filteredMessages = includedTurns
    .flatMap((turn) => turn.messages)
    .filter(({ message }) =>
      roleFilter === TOOLKIT_EXPORT_ROLE_ASSISTANT
        ? message?.role === "assistant"
        : true,
    )
    .map(({ message, sourceIndex }, index) =>
      cloneExportMessageForSelection(message, index + 1, sourceIndex, includeSourceIndex),
    );

  const selectedPayload = {
    ...(payload || {}),
    exportScope: scope,
    roleFilter,
    sourceMessageCount: sourceMessages.length,
    selectedTurnCount: includedTurns.length,
    messageCount: filteredMessages.length,
    messages: filteredMessages,
  };
  if (includeSourceIndex && selectedPayload.rawIncluded) {
    delete selectedPayload.raw;
    selectedPayload.rawIncluded = false;
  }
  return selectedPayload;
};

const buildConversationExportPayload = ({
  conversationId = "",
  title = "",
  url = window.location.href,
  source = "api",
  completeness = "complete",
  branchMode = EXPORT_BRANCH_MODE_ACTIVE,
  messages = [],
  warnings = [],
  apiError = null,
  rawIncluded = false,
  raw = undefined,
} = {}) => {
  const normalizedMessages = normalizeExportMessages(messages);
  const payload = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    url,
    conversationId: conversationId || "",
    title: title || "",
    source,
    completeness,
    branchMode,
    messageCount: normalizedMessages.length,
    messages: normalizedMessages,
  };

  const normalizedWarnings = uniqueExportWarnings(warnings);
  if (normalizedWarnings.length > 0) {
    payload.warnings = normalizedWarnings;
  }

  const serializedApiError = serializeExportApiError(apiError);
  if (serializedApiError) {
    payload.apiError = serializedApiError;
  }

  if (rawIncluded) {
    payload.rawIncluded = true;
  }

  if (rawIncluded && raw !== undefined) {
    payload.raw = cloneExportJsonValue(raw);
  }

  return payload;
};

const resolveConversationTitleFromApi = (data) => {
  const title =
    data?.title ||
    data?.conversation?.title ||
    data?.metadata?.title ||
    "";
  return typeof title === "string" ? title.trim() : "";
};

const getApiMapping = (data) => {
  const mapping = data?.mapping || data?.conversation?.mapping;
  return mapping && typeof mapping === "object" && !Array.isArray(mapping) ? mapping : null;
};

const resolveApiCurrentNodeId = (data, mapping, warnings) => {
  const explicit =
    data?.current_node ||
    data?.current_node_id ||
    data?.conversation?.current_node ||
    data?.conversation?.current_node_id ||
    "";
  if (explicit && mapping?.[explicit]) {
    return explicit;
  }

  const candidates = Object.values(mapping || {}).filter((node) => node?.message);
  if (candidates.length === 0) {
    return "";
  }

  warnings.push("api_current_node_missing_used_latest_message");
  candidates.sort((left, right) => {
    const leftTime = left?.message?.create_time || left?.message?.update_time || 0;
    const rightTime = right?.message?.create_time || right?.message?.update_time || 0;
    return leftTime - rightTime;
  });
  return candidates[candidates.length - 1]?.id || "";
};

const buildActiveApiNodePath = (mapping, currentNodeId, warnings) => {
  const path = [];
  const seen = new Set();
  let nextId = currentNodeId;

  while (nextId && mapping[nextId] && !seen.has(nextId)) {
    seen.add(nextId);
    const node = mapping[nextId];
    path.push(node);
    nextId = node?.parent || "";
  }

  if (nextId && seen.has(nextId)) {
    warnings.push("api_mapping_cycle_detected");
  }

  return path.reverse();
};

const extractTextFromApiPart = (part) => {
  if (typeof part === "string") {
    return part;
  }
  if (!part || typeof part !== "object") {
    return "";
  }

  const directText =
    typeof part.text === "string"
      ? part.text
      : typeof part.content === "string"
        ? part.content
        : typeof part.value === "string"
          ? part.value
          : "";
  if (directText) {
    return directText;
  }

  const nested = Array.isArray(part.parts)
    ? part.parts
    : Array.isArray(part.content)
      ? part.content
      : [];
  return nested.map((item) => extractTextFromApiPart(item)).filter(Boolean).join("\n");
};

const normalizeApiContentPart = (part, index) => {
  if (typeof part === "string") {
    return {
      index,
      type: "text",
      text: part,
    };
  }

  if (!part || typeof part !== "object") {
    return {
      index,
      type: "unknown",
      text: "",
      value: cloneExportJsonValue(part),
    };
  }

  return {
    index,
    type: part.content_type || part.type || "object",
    text: extractTextFromApiPart(part),
    value: cloneExportJsonValue(part),
  };
};

const extractApiMessageParts = (message) => {
  const content = message?.content;
  const rawParts = Array.isArray(content?.parts)
    ? content.parts
    : Array.isArray(content)
      ? content
      : typeof content?.text === "string"
        ? [content.text]
        : [];

  return rawParts.map((part, index) => normalizeApiContentPart(part, index + 1));
};

const extractApiAttachments = (message) => {
  const metadata = message?.metadata || {};
  const attachments = [];
  const appendItems = (items, source) => {
    if (!Array.isArray(items)) {
      return;
    }
    items.forEach((item, index) => {
      if (!item || typeof item !== "object") {
        return;
      }
      attachments.push({
        index: attachments.length + 1,
        source,
        id: item.id || item.file_id || item.asset_pointer || "",
        name: item.name || item.file_name || item.filename || "",
        mimeType: item.mime_type || item.mimeType || "",
        value: cloneExportJsonValue(item),
      });
    });
  };

  appendItems(metadata.attachments, "metadata.attachments");
  appendItems(metadata.files, "metadata.files");
  appendItems(metadata.uploaded_files, "metadata.uploaded_files");

  const contentParts = Array.isArray(message?.content?.parts) ? message.content.parts : [];
  contentParts.forEach((part) => {
    if (!part || typeof part !== "object") {
      return;
    }
    if (!part.asset_pointer && !part.file_id && !part.name) {
      return;
    }
    attachments.push({
      index: attachments.length + 1,
      source: "content.parts",
      id: part.file_id || part.asset_pointer || "",
      name: part.name || part.file_name || part.filename || "",
      mimeType: part.mime_type || part.mimeType || "",
      value: cloneExportJsonValue(part),
    });
  });

  return attachments;
};

const shouldKeepApiMessage = (role, text, parts, attachments) => {
  if (role !== "user" && role !== "assistant") {
    return false;
  }
  return Boolean(text || parts.length > 0 || attachments.length > 0);
};

const isApiToolCallMessage = (message) => {
  const recipient = typeof message?.recipient === "string" ? message.recipient.trim() : "";
  if (recipient && recipient !== "all") {
    return true;
  }

  const metadata = message?.metadata || {};
  return Boolean(
    metadata?.is_visually_hidden_from_conversation ||
      metadata?.is_complete === false ||
      metadata?.aggregate_result ||
      metadata?.command ||
      metadata?.tool_call ||
      metadata?.tool_calls,
  );
};

const normalizeApiMessage = (node, index, conversationModel) => {
  const message = node?.message;
  if (!message || typeof message !== "object") {
    return null;
  }

  const role = message?.author?.role || "unknown";
  if (isApiToolCallMessage(message)) {
    return null;
  }

  const parts = extractApiMessageParts(message);
  const markdown = parts.map((part) => part.text || "").filter(Boolean).join("\n\n");
  const text = markdown.trim();
  const attachments = extractApiAttachments(message);
  if (!shouldKeepApiMessage(role, text, parts, attachments)) {
    return null;
  }

  const metadata = cloneExportJsonValue(message.metadata || {});
  const model =
    message?.metadata?.model_slug ||
    message?.metadata?.default_model_slug ||
    message?.metadata?.model ||
    conversationModel ||
    "";

  return {
    index,
    id: message.id || node?.id || "",
    parentId: node?.parent || "",
    role,
    authorName: message?.author?.name || "",
    createTime: normalizeExportTimestamp(message.create_time),
    updateTime: normalizeExportTimestamp(message.update_time),
    status: message.status || "",
    endTurn: typeof message.end_turn === "boolean" ? message.end_turn : null,
    channel: message.channel || "",
    recipient: message.recipient || "",
    model,
    text,
    markdown,
    parts,
    attachments,
    metadata,
  };
};

const normalizeConversationApiResponse = (data, options = {}) => {
  const warnings = [];
  const mapping = getApiMapping(data);
  if (!mapping) {
    throw new ExportApiError("INVALID_RESPONSE", "Conversation API response has no message mapping.", {
      fallbackAllowed: true,
    });
  }

  const currentNodeId = resolveApiCurrentNodeId(data, mapping, warnings);
  if (!currentNodeId) {
    throw new ExportApiError("INVALID_RESPONSE", "Conversation API response has no active message path.", {
      fallbackAllowed: true,
    });
  }

  const conversationModel =
    data?.default_model_slug ||
    data?.model_slug ||
    data?.conversation?.default_model_slug ||
    "";
  const messages = buildActiveApiNodePath(mapping, currentNodeId, warnings)
    .map((node, index) => normalizeApiMessage(node, index + 1, conversationModel))
    .filter(Boolean)
    .map((message, index) => ({
      ...message,
      index: index + 1,
    }));

  if (messages.length === 0) {
    throw new ExportApiError("EMPTY_EXPORT", "Conversation API response has no exportable messages.", {
      fallbackAllowed: true,
    });
  }

  return buildConversationExportPayload({
    conversationId: options.conversationId || data?.conversation_id || data?.id || "",
    title: resolveConversationTitleFromApi(data),
    url: options.url || window.location.href,
    source: "api",
    completeness: "complete",
    branchMode: EXPORT_BRANCH_MODE_ACTIVE,
    messages,
    warnings,
    apiError: null,
    rawIncluded: Boolean(options.includeRaw),
    raw: options.includeRaw ? data : undefined,
  });
};
