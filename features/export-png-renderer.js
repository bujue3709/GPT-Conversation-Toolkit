/*
 * ChatGPT Conversation Toolkit - Paginated PNG renderer
 *
 * This renderer consumes the normalized export payload. It never screenshots
 * the ChatGPT page, so virtualized or currently unmounted messages are not lost.
 */
const PNG_EXPORT_WIDTH = 1080;
const PNG_EXPORT_MAX_HEIGHT = 8192;
const PNG_EXPORT_MIN_HEIGHT = 360;
const PNG_EXPORT_MAX_PAGES = 999;
const PNG_EXPORT_SIDE_PADDING = 72;
const PNG_EXPORT_TOP_PADDING = 52;
const PNG_EXPORT_BOTTOM_PADDING = 56;
const PNG_EXPORT_HEADER_HEIGHT = 112;
const PNG_EXPORT_CONTENT_TOP = PNG_EXPORT_TOP_PADDING + PNG_EXPORT_HEADER_HEIGHT;
const PNG_EXPORT_CONTENT_WIDTH = PNG_EXPORT_WIDTH - PNG_EXPORT_SIDE_PADDING * 2;
const PNG_EXPORT_PAGE_CAPACITY =
  PNG_EXPORT_MAX_HEIGHT - PNG_EXPORT_CONTENT_TOP - PNG_EXPORT_BOTTOM_PADDING;
const PNG_EXPORT_MESSAGE_GAP = 26;
const PNG_EXPORT_UNIT_GAP = 15;
const PNG_EXPORT_CARD_PADDING_X = 28;
const PNG_EXPORT_CARD_PADDING_TOP = 24;
const PNG_EXPORT_CARD_PADDING_BOTTOM = 26;
const PNG_EXPORT_ROLE_HEIGHT = 30;
const PNG_EXPORT_ROLE_GAP = 16;
const PNG_EXPORT_WATERMARK_PROJECT = "GPT-Conversation-Toolkit";
const PNG_EXPORT_CARD_OVERHEAD =
  PNG_EXPORT_CARD_PADDING_TOP +
  PNG_EXPORT_ROLE_HEIGHT +
  PNG_EXPORT_ROLE_GAP +
  PNG_EXPORT_CARD_PADDING_BOTTOM;

class PngExportError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = "PngExportError";
    this.code = code;
    this.cause = cause || undefined;
  }
}

const getPngExportFailureStatusKey = (error) => {
  if (error?.code === "PNG_CONTENT_TOO_LARGE") {
    return "status.pngContentTooLarge";
  }
  if (error?.code === "PNG_RENDER_FAILED") {
    return "status.pngRenderFailed";
  }
  if (error?.code === "PNG_DATA_FAILED" || error?.name === "ExportApiError") {
    return "status.pngDataFailed";
  }
  return "status.pngUnknownFailed";
};

const createPngMeasureContext = () => {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new PngExportError("PNG_RENDER_FAILED", "Canvas 2D rendering is unavailable.");
  }
  return { canvas, context };
};

const setPngFont = (context, { size = 25, weight = 400, mono = false, italic = false } = {}) => {
  const family = mono
    ? 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'
    : 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  context.font = `${italic ? "italic " : ""}${weight} ${size}px ${family}`;
};

const sanitizePngMarkdownText = (value) =>
  String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_, doubleAlt, singleAlt) =>
      `[Image${doubleAlt || singleAlt ? `: ${doubleAlt || singleAlt}` : ""}]`,
    )
    .replace(/<[^>]+>/g, "")
    .replace(/!\[([^\]]*)\]\([^\s)]+(?:\s+"[^"]*")?\)/g, (_, alt) =>
      `[Image${alt ? `: ${alt}` : ""}]`,
    )
    .replace(/\[([^\]]+)\]\((?:[^()]+|\([^)]*\))*\)/g, "$1");

const parsePngInlineSegments = (value, baseStyle = {}) => {
  const text = sanitizePngMarkdownText(value);
  const segments = [];
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|\*[^*\n]+\*|_[^_\n]+_)/g;
  let offset = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > offset) {
      segments.push({ text: text.slice(offset, match.index), ...baseStyle });
    }
    const token = match[0];
    if (token.startsWith("`")) {
      segments.push({ text: token.slice(1, -1), ...baseStyle, mono: true, code: true });
    } else if (token.startsWith("**") || token.startsWith("__")) {
      segments.push({ text: token.slice(2, -2), ...baseStyle, weight: 700 });
    } else {
      segments.push({ text: token.slice(1, -1), ...baseStyle, italic: true });
    }
    offset = pattern.lastIndex;
  }
  if (offset < text.length || segments.length === 0) {
    segments.push({ text: text.slice(offset), ...baseStyle });
  }
  return segments;
};

const splitPngWrapTokens = (text) =>
  String(text || "")
    .split(/(\n|\s+|[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af])/u)
    .filter((token) => token !== "");

const getPngRunWidth = (context, run, defaults) => {
  setPngFont(context, { ...defaults, ...run });
  return context.measureText(run.text).width;
};

const layoutPngInlineText = (context, segments, maxWidth, defaults = {}) => {
  const lines = [];
  let current = { runs: [], width: 0 };
  const pushLine = (force = false) => {
    if (current.runs.length > 0 || force) {
      lines.push(current);
    }
    current = { runs: [], width: 0 };
  };

  const addToken = (segment, token) => {
    if (token === "\n") {
      pushLine(true);
      return;
    }
    const run = { ...segment, text: token };
    let width = getPngRunWidth(context, run, defaults);
    const isWhitespace = /^\s+$/.test(token);
    if (current.width > 0 && current.width + width > maxWidth && !isWhitespace) {
      pushLine();
    }
    if (width <= maxWidth || isWhitespace) {
      if (!(current.width === 0 && isWhitespace && !defaults.preserveLeadingWhitespace)) {
        current.runs.push({ ...run, width });
        current.width += width;
      }
      return;
    }

    for (const character of Array.from(token)) {
      const characterRun = { ...segment, text: character };
      width = getPngRunWidth(context, characterRun, defaults);
      if (current.width > 0 && current.width + width > maxWidth) {
        pushLine();
      }
      current.runs.push({ ...characterRun, width });
      current.width += width;
    }
  };

  segments.forEach((segment) => {
    splitPngWrapTokens(segment.text).forEach((token) => addToken(segment, token));
  });
  pushLine(lines.length === 0);
  return lines;
};

const isPngMarkdownBlockStart = (line, nextLine = "") =>
  /^\s{0,3}(#{1,6})\s+/.test(line) ||
  /^\s{0,3}(```+|~~~+)/.test(line) ||
  /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
  /^\s*>/.test(line) ||
  /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) ||
  (/\|/.test(line) && /^\s*\|?\s*:?-{3,}/.test(nextLine));

const splitPngTableRow = (line) => {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
};

const parsePngMarkdownBlocks = (value) => {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s{0,3}(```+|~~~+)\s*([^\s]*)?.*$/);
    if (fence) {
      const marker = fence[1];
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^\\s{0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }
      blocks.push({ kind: "code", language: fence[2] || "", lines: codeLines.length ? codeLines : [""] });
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2].trim() });
      index += 1;
      continue;
    }

    if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      index += 1;
      continue;
    }

    if (
      index + 1 < lines.length &&
      /\|/.test(line) &&
      /^\s*\|?\s*:?-{3,}/.test(lines[index + 1])
    ) {
      const header = splitPngTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && /\|/.test(lines[index])) {
        rows.push(splitPngTableRow(lines[index]));
        index += 1;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ kind: "quote", text: quoteLines.join("\n") });
      continue;
    }

    const listItem = line.match(/^\s*((?:[-+*])|(?:\d+[.)]))\s+(.+)$/);
    if (listItem) {
      const content = [listItem[2]];
      index += 1;
      while (
        index < lines.length &&
        /^\s{2,}\S/.test(lines[index]) &&
        !/^\s*(?:[-+*]|\d+[.)])\s+/.test(lines[index])
      ) {
        content.push(lines[index].trim());
        index += 1;
      }
      blocks.push({
        kind: "list-item",
        marker: /^\d/.test(listItem[1]) ? listItem[1] : "•",
        text: content.join(" "),
      });
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isPngMarkdownBlockStart(lines[index], lines[index + 1] || "")
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
};

const createPngTextUnit = (context, block, contentWidth) => {
  const kind = block.kind;
  const isHeading = kind === "heading";
  const size = isHeading ? Math.max(27, 38 - Math.min(block.level || 1, 4) * 2) : 25;
  const lineHeight = isHeading ? size + 11 : 36;
  const inset = kind === "quote" ? 30 : kind === "list-item" ? 42 : 0;
  const lines = layoutPngInlineText(
    context,
    parsePngInlineSegments(block.text, { weight: isHeading ? 700 : 400 }),
    Math.max(80, contentWidth - inset),
    { size, weight: isHeading ? 700 : 400 },
  );
  const verticalPadding = kind === "quote" ? 24 : 0;
  return {
    ...block,
    type: "text",
    lines,
    size,
    lineHeight,
    height: Math.max(lineHeight, lines.length * lineHeight + verticalPadding),
  };
};

const createPngCodeUnit = (context, block, contentWidth) => {
  const innerWidth = contentWidth - 36;
  const groups = (block.lines || [""]).map((line) => ({
    source: line,
    lines: layoutPngInlineText(
      context,
      [{ text: line || " ", mono: true }],
      innerWidth,
      { size: 21, mono: true, preserveLeadingWhitespace: true },
    ),
  }));
  const labelHeight = block.language ? 28 : 0;
  return {
    ...block,
    type: "code",
    groups,
    lineHeight: 29,
    labelHeight,
    height: 30 + labelHeight + groups.reduce((sum, group) => sum + group.lines.length * 29, 0),
  };
};

const layoutPngTableRow = (context, cells, columnWidths, bold = false) => {
  const layouts = columnWidths.map((width, columnIndex) =>
    layoutPngInlineText(
      context,
      parsePngInlineSegments(cells[columnIndex] || "", { weight: bold ? 700 : 400 }),
      Math.max(40, width - 24),
      { size: 20, weight: bold ? 700 : 400 },
    ),
  );
  const lineCount = Math.max(1, ...layouts.map((lines) => lines.length));
  return { cells: layouts, height: Math.max(48, lineCount * 28 + 20) };
};

const createPngTableUnit = (context, block, contentWidth) => {
  const columnCount = Math.max(1, block.header.length, ...block.rows.map((row) => row.length));
  const columnWidths = Array(columnCount).fill(contentWidth / columnCount);
  const header = layoutPngTableRow(context, block.header, columnWidths, true);
  const rows = block.rows.map((row) => layoutPngTableRow(context, row, columnWidths, false));
  return {
    ...block,
    type: "table",
    columnWidths,
    header,
    rows,
    height: header.height + rows.reduce((sum, row) => sum + row.height, 0),
  };
};

const createPngRenderUnit = (context, block, contentWidth) => {
  if (block.kind === "rule") {
    return { ...block, type: "rule", height: 18 };
  }
  if (block.kind === "code") {
    return createPngCodeUnit(context, block, contentWidth);
  }
  if (block.kind === "table") {
    return createPngTableUnit(context, block, contentWidth);
  }
  return createPngTextUnit(context, block, contentWidth);
};

const getPngMessageMarkdown = (payload, message) =>
  payload?.source === "api" && typeof message?.__markdown === "string"
    ? message.__markdown
    : message?.text || "";

const buildPngMessageModel = (context, payload, message) => {
  const contentWidth = PNG_EXPORT_CONTENT_WIDTH - PNG_EXPORT_CARD_PADDING_X * 2;
  const blocks = parsePngMarkdownBlocks(getPngMessageMarkdown(payload, message));
  (message?.attachments || []).forEach((attachment) => {
    blocks.push({
      kind: "paragraph",
      text: `[Image${attachment?.name ? `: ${attachment.name}` : ""}]`,
    });
  });
  if (blocks.length === 0) {
    blocks.push({ kind: "paragraph", text: "" });
  }
  const units = blocks.map((block) => createPngRenderUnit(context, block, contentWidth));
  return { role: message?.role || "message", units };
};

const getPngUnitsHeight = (units) =>
  units.reduce((sum, unit, index) => sum + unit.height + (index > 0 ? PNG_EXPORT_UNIT_GAP : 0), 0);

const createPngMessageFragment = (model, units, continued = false) => ({
  role: model.role,
  units,
  continued,
  height: PNG_EXPORT_CARD_OVERHEAD + getPngUnitsHeight(units),
});

const splitPngTextUnit = (unit, maxHeight) => {
  const padding = unit.kind === "quote" ? 24 : 0;
  const maxLines = Math.max(1, Math.floor((maxHeight - padding) / unit.lineHeight));
  if (unit.lines.length <= maxLines) {
    return [unit];
  }
  const pieces = [];
  for (let index = 0; index < unit.lines.length; index += maxLines) {
    const lines = unit.lines.slice(index, index + maxLines);
    pieces.push({
      ...unit,
      lines,
      continuedUnit: index > 0,
      height: lines.length * unit.lineHeight + padding,
    });
  }
  return pieces;
};

const makePngCodePiece = (unit, groups, continued) => {
  const labelHeight = unit.language || continued ? 28 : 0;
  return {
    ...unit,
    groups,
    continuedUnit: continued,
    labelHeight,
    height: 30 + labelHeight + groups.reduce((sum, group) => sum + group.lines.length * unit.lineHeight, 0),
  };
};

const splitPngCodeUnit = (unit, maxHeight) => {
  if (unit.height <= maxHeight) {
    return [unit];
  }
  const pieces = [];
  let groups = [];
  let continued = false;
  const flush = () => {
    if (groups.length > 0) {
      pieces.push(makePngCodePiece(unit, groups, continued));
      groups = [];
      continued = true;
    }
  };

  unit.groups.forEach((group) => {
    const candidate = makePngCodePiece(unit, [...groups, group], continued);
    if (groups.length > 0 && candidate.height > maxHeight) {
      flush();
    }
    const emptyCapacity = Math.max(
      1,
      Math.floor((maxHeight - 30 - (unit.language || continued ? 28 : 0)) / unit.lineHeight),
    );
    if (group.lines.length > emptyCapacity) {
      flush();
      for (let index = 0; index < group.lines.length; index += emptyCapacity) {
        const lineGroup = { ...group, lines: group.lines.slice(index, index + emptyCapacity) };
        groups = [lineGroup];
        flush();
      }
    } else {
      groups.push(group);
    }
  });
  flush();
  return pieces;
};

const makePngTablePiece = (unit, rows, continued) => ({
  ...unit,
  rows,
  continuedUnit: continued,
  height: unit.header.height + rows.reduce((sum, row) => sum + row.height, 0),
});

const splitPngTallTableRow = (row, unit, maxHeight) => {
  const available = Math.max(28, maxHeight - unit.header.height - 20);
  const linesPerPiece = Math.max(1, Math.floor(available / 28));
  const totalLines = Math.max(...row.cells.map((cell) => cell.length), 1);
  const pieces = [];
  for (let offset = 0; offset < totalLines; offset += linesPerPiece) {
    const cells = row.cells.map((cell) => cell.slice(offset, offset + linesPerPiece));
    const lineCount = Math.max(1, ...cells.map((cell) => cell.length));
    pieces.push({ cells, height: lineCount * 28 + 20 });
  }
  return pieces;
};

const splitPngTableUnit = (unit, maxHeight) => {
  if (unit.height <= maxHeight) {
    return [unit];
  }
  const pieces = [];
  let rows = [];
  const flush = () => {
    if (rows.length > 0) {
      pieces.push(makePngTablePiece(unit, rows, pieces.length > 0));
      rows = [];
    }
  };
  unit.rows.forEach((row) => {
    const rowPieces = unit.header.height + row.height > maxHeight
      ? splitPngTallTableRow(row, unit, maxHeight)
      : [row];
    rowPieces.forEach((rowPiece) => {
      const candidate = makePngTablePiece(unit, [...rows, rowPiece], pieces.length > 0);
      if (rows.length > 0 && candidate.height > maxHeight) {
        flush();
      }
      rows.push(rowPiece);
      if (makePngTablePiece(unit, rows, pieces.length > 0).height >= maxHeight) {
        flush();
      }
    });
  });
  flush();
  if (pieces.length === 0) {
    pieces.push(makePngTablePiece(unit, [], false));
  }
  return pieces;
};

const splitPngRenderUnit = (unit, maxHeight) => {
  if (unit.height <= maxHeight) {
    return [unit];
  }
  if (unit.type === "code") {
    return splitPngCodeUnit(unit, maxHeight);
  }
  if (unit.type === "table") {
    return splitPngTableUnit(unit, maxHeight);
  }
  if (unit.type === "text") {
    return splitPngTextUnit(unit, maxHeight);
  }
  return [unit];
};

const splitPngMessageModel = (model) => {
  const maxUnitsHeight = PNG_EXPORT_PAGE_CAPACITY - PNG_EXPORT_CARD_OVERHEAD;
  const units = model.units.flatMap((unit) => splitPngRenderUnit(unit, maxUnitsHeight));
  const fragments = [];
  let currentUnits = [];
  let currentHeight = 0;

  const flush = () => {
    if (currentUnits.length > 0) {
      fragments.push(createPngMessageFragment(model, currentUnits, fragments.length > 0));
      currentUnits = [];
      currentHeight = 0;
    }
  };

  units.forEach((unit) => {
    const addition = unit.height + (currentUnits.length > 0 ? PNG_EXPORT_UNIT_GAP : 0);
    if (currentUnits.length > 0 && currentHeight + addition > maxUnitsHeight) {
      flush();
    }
    currentUnits.push(unit);
    currentHeight += unit.height + (currentUnits.length > 1 ? PNG_EXPORT_UNIT_GAP : 0);
  });
  flush();
  return fragments;
};

const createPngPage = () => ({ items: [], usedHeight: 0 });

const addPngItemToPage = (page, item) => {
  const gap = page.items.length > 0 ? PNG_EXPORT_MESSAGE_GAP : 0;
  page.items.push(item);
  page.usedHeight += gap + item.height;
};

const paginateConversationForPng = (payload, context) => {
  const pages = [];
  let page = createPngPage();
  const finishPage = () => {
    if (page.items.length > 0) {
      pages.push(page);
      if (pages.length > PNG_EXPORT_MAX_PAGES) {
        throw new PngExportError(
          "PNG_CONTENT_TOO_LARGE",
          `The export exceeds the ${PNG_EXPORT_MAX_PAGES}-page safety limit.`,
        );
      }
    }
    page = createPngPage();
  };

  (payload?.messages || []).forEach((message) => {
    const model = buildPngMessageModel(context, payload, message);
    const whole = createPngMessageFragment(model, model.units, false);
    if (whole.height <= PNG_EXPORT_PAGE_CAPACITY) {
      const required = whole.height + (page.items.length > 0 ? PNG_EXPORT_MESSAGE_GAP : 0);
      if (page.items.length > 0 && page.usedHeight + required > PNG_EXPORT_PAGE_CAPACITY) {
        finishPage();
      }
      addPngItemToPage(page, whole);
      return;
    }

    if (page.items.length > 0) {
      finishPage();
    }
    splitPngMessageModel(model).forEach((fragment) => {
      const required = fragment.height + (page.items.length > 0 ? PNG_EXPORT_MESSAGE_GAP : 0);
      if (page.items.length > 0 && page.usedHeight + required > PNG_EXPORT_PAGE_CAPACITY) {
        finishPage();
      }
      addPngItemToPage(page, fragment);
    });
  });
  finishPage();
  return pages;
};

const drawPngRoundedRect = (context, x, y, width, height, radius) => {
  const safeRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.arcTo(x + width, y, x + width, y + height, safeRadius);
  context.arcTo(x + width, y + height, x, y + height, safeRadius);
  context.arcTo(x, y + height, x, y, safeRadius);
  context.arcTo(x, y, x + width, y, safeRadius);
  context.closePath();
};

const drawPngInlineLines = (context, lines, x, y, options = {}) => {
  const size = options.size || 25;
  const lineHeight = options.lineHeight || 36;
  lines.forEach((line, lineIndex) => {
    let runX = x;
    line.runs.forEach((run) => {
      setPngFont(context, {
        size,
        weight: run.weight || options.weight || 400,
        mono: run.mono || options.mono,
        italic: run.italic,
      });
      if (run.code) {
        context.fillStyle = "#eef0f3";
        drawPngRoundedRect(context, runX - 3, y + lineIndex * lineHeight + 2, run.width + 6, lineHeight - 5, 5);
        context.fill();
      }
      context.fillStyle = options.color || "#202123";
      context.fillText(run.text, runX, y + lineIndex * lineHeight);
      runX += run.width;
    });
  });
};

const drawPngTextUnit = (context, unit, x, y, width) => {
  if (unit.kind === "quote") {
    context.fillStyle = "#f6f7f9";
    drawPngRoundedRect(context, x, y, width, unit.height, 10);
    context.fill();
    context.fillStyle = "#9ca3af";
    context.fillRect(x, y, 5, unit.height);
    drawPngInlineLines(context, unit.lines, x + 22, y + 12, {
      size: unit.size,
      lineHeight: unit.lineHeight,
      color: "#4b5563",
    });
    return;
  }
  if (unit.kind === "list-item") {
    setPngFont(context, { size: 24, weight: 600 });
    context.fillStyle = "#202123";
    context.fillText(unit.continuedUnit ? "↳" : unit.marker, x, y);
    drawPngInlineLines(context, unit.lines, x + 42, y, {
      size: unit.size,
      lineHeight: unit.lineHeight,
    });
    return;
  }
  drawPngInlineLines(context, unit.lines, x, y, {
    size: unit.size,
    lineHeight: unit.lineHeight,
    weight: unit.kind === "heading" ? 700 : 400,
  });
};

const drawPngCodeUnit = (context, unit, x, y, width) => {
  context.fillStyle = "#17191d";
  drawPngRoundedRect(context, x, y, width, unit.height, 12);
  context.fill();
  let cursorY = y + 15;
  if (unit.labelHeight) {
    setPngFont(context, { size: 17, weight: 600, mono: true });
    context.fillStyle = "#aeb4bf";
    const label = [unit.language, unit.continuedUnit ? "continued" : ""].filter(Boolean).join(" · ");
    context.fillText(label || "continued", x + 18, cursorY);
    cursorY += unit.labelHeight;
  }
  context.save();
  context.beginPath();
  context.rect(x + 12, cursorY, width - 24, unit.height - (cursorY - y) - 10);
  context.clip();
  unit.groups.forEach((group) => {
    drawPngInlineLines(context, group.lines, x + 18, cursorY, {
      size: 21,
      lineHeight: unit.lineHeight,
      mono: true,
      color: "#f4f4f5",
    });
    cursorY += group.lines.length * unit.lineHeight;
  });
  context.restore();
};

const drawPngTableRow = (context, row, columnWidths, x, y, bold, fill) => {
  const totalWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  context.fillStyle = fill;
  context.fillRect(x, y, totalWidth, row.height);
  let cellX = x;
  row.cells.forEach((lines, index) => {
    context.strokeStyle = "#d8dce2";
    context.strokeRect(cellX, y, columnWidths[index], row.height);
    drawPngInlineLines(context, lines, cellX + 12, y + 10, {
      size: 20,
      lineHeight: 28,
      weight: bold ? 700 : 400,
    });
    cellX += columnWidths[index];
  });
};

const drawPngTableUnit = (context, unit, x, y) => {
  let cursorY = y;
  drawPngTableRow(context, unit.header, unit.columnWidths, x, cursorY, true, "#f0f2f5");
  cursorY += unit.header.height;
  unit.rows.forEach((row, index) => {
    drawPngTableRow(
      context,
      row,
      unit.columnWidths,
      x,
      cursorY,
      false,
      index % 2 === 0 ? "#ffffff" : "#fafafa",
    );
    cursorY += row.height;
  });
};

const drawPngRenderUnit = (context, unit, x, y, width) => {
  if (unit.type === "rule") {
    context.fillStyle = "#d8dce2";
    context.fillRect(x, y + 8, width, 2);
  } else if (unit.type === "code") {
    drawPngCodeUnit(context, unit, x, y, width);
  } else if (unit.type === "table") {
    drawPngTableUnit(context, unit, x, y);
  } else {
    drawPngTextUnit(context, unit, x, y, width);
  }
};

const getPngRoleLabel = (role, continued) => {
  const normalizedRole = role === "assistant" ? "ChatGPT" : role === "user" ? "User" : "Message";
  return continued ? `${normalizedRole} · continued` : normalizedRole;
};

const drawPngMessageFragment = (context, fragment, x, y, width) => {
  const isUser = fragment.role === "user";
  context.fillStyle = isUser ? "#f3f4f6" : "#ffffff";
  context.strokeStyle = isUser ? "#e2e5e9" : "#dfe3e8";
  context.lineWidth = 1.5;
  drawPngRoundedRect(context, x, y, width, fragment.height, 16);
  context.fill();
  context.stroke();

  const contentX = x + PNG_EXPORT_CARD_PADDING_X;
  let cursorY = y + PNG_EXPORT_CARD_PADDING_TOP;
  context.fillStyle = isUser ? "#5b6472" : "#0b8f70";
  setPngFont(context, { size: 21, weight: 700 });
  context.fillText(getPngRoleLabel(fragment.role, fragment.continued), contentX, cursorY);
  cursorY += PNG_EXPORT_ROLE_HEIGHT + PNG_EXPORT_ROLE_GAP;
  const contentWidth = width - PNG_EXPORT_CARD_PADDING_X * 2;
  fragment.units.forEach((unit, index) => {
    if (index > 0) {
      cursorY += PNG_EXPORT_UNIT_GAP;
    }
    drawPngRenderUnit(context, unit, contentX, cursorY, contentWidth);
    cursorY += unit.height;
  });
};

const truncatePngTitle = (context, title, maxWidth) => {
  const cleanTitle = String(title || "ChatGPT Conversation").replace(/\s+/g, " ").trim();
  setPngFont(context, { size: 32, weight: 750 });
  if (context.measureText(cleanTitle).width <= maxWidth) {
    return cleanTitle;
  }
  const characters = Array.from(cleanTitle);
  while (characters.length > 1 && context.measureText(`${characters.join("")}…`).width > maxWidth) {
    characters.pop();
  }
  return `${characters.join("")}…`;
};

const getPngWatermarkParts = () => {
  const translate = typeof t === "function" ? t : null;
  const placeholder = "__GPT_CONVERSATION_TOOLKIT__";
  const localized = translate
    ? translate("png.watermark", { project: placeholder })
    : `Exported by ${placeholder}`;
  const placeholderIndex = localized.indexOf(placeholder);
  if (placeholderIndex < 0) {
    return {
      prefix: "Exported by ",
      project: PNG_EXPORT_WATERMARK_PROJECT,
      suffix: "",
    };
  }
  return {
    prefix: localized.slice(0, placeholderIndex),
    project: PNG_EXPORT_WATERMARK_PROJECT,
    suffix: localized.slice(placeholderIndex + placeholder.length),
  };
};

const drawPngWatermark = (context, pageHeight, parts = getPngWatermarkParts()) => {
  const fontSize = 16;
  setPngFont(context, { size: fontSize, weight: 400 });
  const prefixWidth = context.measureText(parts.prefix).width;
  const suffixWidth = context.measureText(parts.suffix).width;
  setPngFont(context, { size: fontSize, weight: 700 });
  const projectWidth = context.measureText(parts.project).width;
  let cursorX = PNG_EXPORT_WIDTH - PNG_EXPORT_SIDE_PADDING - prefixWidth - projectWidth - suffixWidth;
  const y = pageHeight - 31;

  context.textAlign = "left";
  context.fillStyle = "#9ca3af";
  setPngFont(context, { size: fontSize, weight: 400 });
  context.fillText(parts.prefix, cursorX, y);
  cursorX += prefixWidth;

  context.fillStyle = "#0b8f70";
  setPngFont(context, { size: fontSize, weight: 700 });
  context.fillText(parts.project, cursorX, y);
  context.fillRect(cursorX, y + 20, projectWidth, 1);
  cursorX += projectWidth;

  context.fillStyle = "#9ca3af";
  setPngFont(context, { size: fontSize, weight: 400 });
  context.fillText(parts.suffix, cursorX, y);
};

const renderPngPageToBlob = (payload, page, pageIndex, pageCount, watermarkParts) => {
  const pageHeight = Math.min(
    PNG_EXPORT_MAX_HEIGHT,
    Math.max(
      PNG_EXPORT_MIN_HEIGHT,
      Math.ceil(PNG_EXPORT_CONTENT_TOP + page.usedHeight + PNG_EXPORT_BOTTOM_PADDING),
    ),
  );
  const canvas = document.createElement("canvas");
  canvas.width = PNG_EXPORT_WIDTH;
  canvas.height = pageHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    canvas.width = 0;
    canvas.height = 0;
    throw new PngExportError("PNG_RENDER_FAILED", "Canvas 2D rendering is unavailable.");
  }

  context.textBaseline = "top";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#111827";
  setPngFont(context, { size: 32, weight: 750 });
  context.fillText(
    truncatePngTitle(context, payload?.title, PNG_EXPORT_CONTENT_WIDTH - 180),
    PNG_EXPORT_SIDE_PADDING,
    PNG_EXPORT_TOP_PADDING,
  );
  context.textAlign = "right";
  context.fillStyle = "#6b7280";
  setPngFont(context, { size: 18, weight: 600 });
  context.fillText(
    pageCount > 1 ? `${pageIndex + 1} / ${pageCount}` : "ChatGPT",
    PNG_EXPORT_WIDTH - PNG_EXPORT_SIDE_PADDING,
    PNG_EXPORT_TOP_PADDING + 8,
  );
  context.textAlign = "left";
  context.fillStyle = "#e5e7eb";
  context.fillRect(PNG_EXPORT_SIDE_PADDING, PNG_EXPORT_CONTENT_TOP - 28, PNG_EXPORT_CONTENT_WIDTH, 2);

  let cursorY = PNG_EXPORT_CONTENT_TOP;
  page.items.forEach((item, index) => {
    if (index > 0) {
      cursorY += PNG_EXPORT_MESSAGE_GAP;
    }
    drawPngMessageFragment(
      context,
      item,
      PNG_EXPORT_SIDE_PADDING,
      cursorY,
      PNG_EXPORT_CONTENT_WIDTH,
    );
    cursorY += item.height;
  });
  drawPngWatermark(context, pageHeight, watermarkParts);

  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (!blob) {
          reject(new PngExportError("PNG_RENDER_FAILED", `PNG page ${pageIndex + 1} could not be encoded.`));
          return;
        }
        resolve(blob);
      }, "image/png");
    } catch (error) {
      canvas.width = 0;
      canvas.height = 0;
      reject(new PngExportError("PNG_RENDER_FAILED", `PNG page ${pageIndex + 1} could not be rendered.`, error));
    }
  });
};

const buildConversationPngFilename = (payload, pageIndex, pageCount, baseFilename = "") => {
  const filename = baseFilename || buildConversationExportFilename(payload, "png");
  if (pageCount <= 1) {
    return filename;
  }
  const part = String(pageIndex + 1).padStart(2, "0");
  return filename.replace(/\.png$/i, `-part-${part}.png`);
};

const downloadPngBlob = (blob, filename) => {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(blob);
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

const yieldPngExportThread = () => new Promise((resolve) => setTimeout(resolve, 80));

const exportConversationPng = async (payload, options = {}) => {
  if (!Array.isArray(payload?.messages) || payload.messages.length === 0) {
    throw new PngExportError("PNG_DATA_FAILED", "No conversation messages are available for PNG export.");
  }

  updateStatusByKey("status.pngGenerating", "info");
  let measureCanvas = null;
  let pages;
  try {
    const measurement = createPngMeasureContext();
    measureCanvas = measurement.canvas;
    pages = paginateConversationForPng(payload, measurement.context);
  } catch (error) {
    if (error instanceof PngExportError) {
      throw error;
    }
    throw new PngExportError("PNG_RENDER_FAILED", "The conversation layout could not be generated.", error);
  } finally {
    if (measureCanvas) {
      measureCanvas.width = 0;
      measureCanvas.height = 0;
    }
  }

  if (!pages.length) {
    throw new PngExportError("PNG_DATA_FAILED", "No renderable conversation content was found.");
  }

  const baseFilename = buildConversationExportFilename(payload, "png");
  const watermarkParts = getPngWatermarkParts();
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    if (pages.length > 1) {
      updateStatusByKey("status.pngGeneratingPage", "info", {
        current: pageIndex + 1,
        total: pages.length,
      });
    }
    const blob = await renderPngPageToBlob(
      payload,
      pages[pageIndex],
      pageIndex,
      pages.length,
      watermarkParts,
    );
    downloadPngBlob(
      blob,
      buildConversationPngFilename(payload, pageIndex, pages.length, baseFilename),
    );
    if (pageIndex + 1 < pages.length) {
      await yieldPngExportThread();
    }
  }

  if (options.usedFallback) {
    updateStatusByKey(
      pages.length > 1 ? "status.pngFallbackDoneMultiple" : "status.pngFallbackDone",
      "warn",
      { count: pages.length },
    );
  } else {
    updateStatusByKey(
      pages.length > 1 ? "status.pngDoneMultiple" : "status.pngDone",
      "success",
      { count: pages.length },
    );
  }
  return { pageCount: pages.length };
};
