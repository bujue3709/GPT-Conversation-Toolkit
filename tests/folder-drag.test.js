const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "features", "folders.js"), "utf8");

// Model the observed sidebar: listitem > wrappers > link, with sibling actions.
const createFixture = () => {
  class Element {
    constructor(tag = "div", top = 0, height = 38) {
      this.tag = tag;
      this.children = [];
      this.parentElement = null;
      this.attributes = new Map();
      this.dataset = {};
      this.style = { order: "" };
      this.top = top;
      this.height = height;
      const classes = new Set();
      this.classList = {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
      };
    }
    append(child) { child.parentElement = this; this.children.push(child); return child; }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    hasAttribute(name) { return this.attributes.has(name); }
    contains(node) {
      for (let current = node; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }
    matches(selector) {
      return selector.split(",").some((part) => {
        part = part.trim();
        if (part.startsWith(".")) return this.classList.contains(part.slice(1));
        const tag = part.match(/^[a-z]+/)?.[0];
        if (tag && tag !== this.tag) return false;
        const attrs = [...part.matchAll(/\[([\w-]+)(\*?=)?["']?([^\]"']*)["']?\]/g)];
        return (tag || attrs.length) && attrs.every(([, name, op, value]) =>
          op === "*=" ? (this.getAttribute(name) || "").includes(value) :
          op === "=" ? this.getAttribute(name) === value : this.hasAttribute(name));
      });
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (node.matches(selector)) return node;
      }
      return null;
    }
    querySelectorAll(selector) {
      return this.children.flatMap((child) => [
        ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
      ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    getBoundingClientRect() {
      return { left: 0, right: 300, top: this.top, bottom: this.top + this.height, width: 300, height: this.height };
    }
    compareDocumentPosition() { return 4; }
  }
  class Anchor extends Element { constructor() { super("a"); } }
  class Button extends Element { constructor() { super("button"); } }

  const history = new Element("div", 0, 600);
  const createHeader = (id, top, order) => {
    const header = history.append(new Element("div", top, 32));
    header.classList.add("chatgpt-toolkit-folder-header");
    header.dataset.folderId = id;
    header.setAttribute("data-toolkit-folder-dropzone", "folder");
    header.style.order = String(order);
    return header;
  };
  const working = createHeader("working", 0, 0);
  const createRow = (id, top, order, folderId = "") => {
    const row = history.append(new Element("div", top));
    row.setAttribute("data-sidebar-chatgpt-conversation-key", `chatgpt:conversation:${id}`);
    row.style.order = String(order);
    if (folderId) row.setAttribute("data-toolkit-folder-id", folderId);
    const wrapper = row.append(new Element());
    const anchor = wrapper.append(new Anchor());
    anchor.setAttribute("href", `/g/project/c/${id}`);
    anchor.setAttribute("data-interactive-row-link", "true");
    const title = anchor.append(new Element("span"));
    const actions = row.append(new Button());
    const editor = row.append(new Element("input"));
    return { row, anchor, title, actions, editor };
  };
  const first = createRow("first", 34, 1, "working");
  const second = createRow("second", 74, 2, "working");
  const other = createHeader("other", 116, 3);
  const outside = createRow("outside", 200, 4);
  const state = {
    initialized: false, loaded: true, history, folders: [
      { id: "working", order: 0, createdAt: 1 }, { id: "other", order: 1, createdAt: 2 },
    ], assignments: { first: "working", second: "working" }, itemOrders: { working: ["first", "second"] },
  };
  const listeners = new Map();
  const snapshots = [];
  const document = {
    documentElement: new Element("html"), getElementById: () => null,
    addEventListener: (type, callback, capture) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push({ callback, capture });
    },
  };
  const sandbox = {
    HTMLElement: Element, HTMLAnchorElement: Anchor, HTMLButtonElement: Button, Element,
    Node: { DOCUMENT_POSITION_FOLLOWING: 4 }, document, folderState: state,
    FOLDER_MANAGER_ID: "manager", FOLDER_MENU_ID: "menu", folderSettledRefreshTimer: null,
    requestAnimationFrame() {}, setTimeout() { return 1; }, clearTimeout() {},
    saveFolderSnapshot: (snapshot) => snapshots.push(snapshot),
  };
  vm.runInNewContext(`${source}\nglobalThis.api = {
    bindFolderGlobalEvents, getConversationIdFromItem, getConversationItemFromTarget,
    buildConversationDropLayout, clearFolderDragState
  };`, sandbox);
  sandbox.api.bindFolderGlobalEvents();
  const dispatch = (type, target, options = {}) => {
    const payload = new Map();
    const event = {
      target, button: 0, clientX: 100, clientY: target.top + 10,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { this.stopped = true; },
      dataTransfer: { setData: (key, value) => payload.set(key, value) }, ...options,
    };
    for (const listener of listeners.get(type) || []) {
      if (listener.capture) listener.callback(event);
    }
    return event;
  };
  return { ...sandbox.api, history, state, first, second, outside, working, other, dispatch, snapshots, Element };
};

test("mouse dragging a chat bypasses native pointer and mouse sensors without cancelling HTML drag", () => {
  const f = createFixture();
  for (const type of ["pointerdown", "mousedown", "dragstart"]) {
    const event = f.dispatch(type, f.first.title, { pointerType: "mouse" });
    assert.equal(event.stopped, true, `${type} must not reach the native sidebar sensor`);
    assert.equal(event.defaultPrevented, false, `${type} must keep the browser drag default`);
  }
  assert.equal(f.state.draggingConversationId, "first");
});

test("native action buttons, editors, touch, right-clicks and unrelated links remain usable", () => {
  const f = createFixture();
  const cases = [
    [f.first.actions, {}], [f.first.editor, {}],
    [f.first.title, { button: 2 }], [f.first.title, { pointerType: "touch" }],
    [new f.Element("a"), {}],
  ];
  for (const [target, options] of cases) {
    const event = f.dispatch("pointerdown", target, options);
    assert.equal(event.stopped, false);
    assert.equal(event.defaultPrevented, false);
  }
  f.dispatch("pointerdown", f.first.actions);
  assert.equal(f.dispatch("dragstart", f.first.anchor).defaultPrevented, true);
  assert.equal(f.state.draggingConversationId, undefined);
});

test("wrapped rows and padding resolve to their conversation and appear once in the drop layout", () => {
  const f = createFixture();
  assert.equal(f.getConversationIdFromItem(f.first.row), "first");
  assert.equal(f.getConversationItemFromTarget(f.first.row), f.first.anchor);
  const layout = f.buildConversationDropLayout();
  assert.deepEqual(Array.from(layout.folderZones[0].itemPlacements, (p) => p.conversationId), ["first", "second"]);
});

test("dragging an ungrouped conversation to a folder saves its assignment", () => {
  const f = createFixture();
  f.dispatch("dragstart", f.outside.title);
  const over = f.dispatch("dragover", f.other, { clientY: 125 });
  assert.equal(over.defaultPrevented, true);
  assert.equal(over.stopped, true);
  const drop = f.dispatch("drop", f.other, { clientY: 125 });
  assert.equal(drop.stopped, true);
  assert.equal(f.state.assignments.outside, "other");
  assert.deepEqual(Array.from(f.state.itemOrders.other), ["outside"]);
  assert.equal(f.snapshots.at(-1).assignments.outside, "other");
  assert.equal(f.state.draggingConversationId, null);
});

test("dropping on row padding reorders a folder conversation and persists the new order", () => {
  const f = createFixture();
  f.dispatch("dragstart", f.first.title);
  f.dispatch("drop", f.second.row, { clientY: 108 });
  assert.deepEqual(Array.from(f.state.itemOrders.working), ["second", "first"]);
  assert.deepEqual(Array.from(f.snapshots.at(-1).itemOrders.working), ["second", "first"]);
});

test("the whitespace between folder conversations supports insertion before the next chat", () => {
  const f = createFixture();
  f.dispatch("dragstart", f.outside.title);
  f.dispatch("drop", f.history, { clientY: 73 });
  assert.deepEqual(Array.from(f.state.itemOrders.working), ["first", "outside", "second"]);
  assert.equal(f.state.assignments.outside, "working");
});

test("a drop outside the managed list clears drag state without changing assignments", () => {
  const f = createFixture();
  f.dispatch("dragstart", f.first.title);
  f.dispatch("drop", new f.Element(), { clientX: 400, clientY: 700 });
  assert.equal(f.state.assignments.first, "working");
  assert.equal(f.snapshots.length, 0);
  assert.equal(f.state.draggingConversationId, null);
});
