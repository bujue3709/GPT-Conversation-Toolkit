const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "features", "folders.js"), "utf8");

const createFixture = () => {
  const timers = new Map();
  let nextTimerId = 1;
  class Element {
    constructor() {
      this.children = [];
      this.parentElement = null;
      this.isConnected = true;
      this.scrollTop = 0;
      this.scrollHeight = 2000;
      this.clientHeight = 300;
      this.attributes = new Map();
      this.classList = { contains: () => false };
      this.style = { setProperty() {}, removeProperty() {} };
    }
    contains(node) {
      for (let current = node; current; current = current.parentElement) {
        if (current === this) return true;
      }
      return false;
    }
    hasAttribute(name) { return this.attributes.has(name); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    removeAttribute(name) { this.attributes.delete(name); }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { top: 100, left: 0, width: 318 }; }
  }
  class Anchor extends Element {}
  class Button extends Element {}

  const body = new Element();
  const scrollRoot = new Element();
  scrollRoot.parentElement = body;
  const section = new Element();
  section.parentElement = scrollRoot;
  section.loading = true;
  section.querySelector = (selector) => selector === '[role="status"]' && section.loading ? {} : null;
  const history = new Element();
  history.parentElement = section;
  history.querySelectorAll = () => history.children;
  const appendRow = () => {
    const row = new Anchor();
    row.parentElement = history;
    history.children.push(row);
  };
  appendRow();
  appendRow();

  const label = new Element();
  const button = new Button();
  const manager = new Element();
  manager.querySelector = (selector) =>
    selector.includes("manager-label") ? label : selector.includes('load-all') ? button : null;
  const sandbox = {
    HTMLElement: Element,
    HTMLAnchorElement: Anchor,
    HTMLButtonElement: Button,
    Element,
    document: { body, hidden: false, getElementById: () => manager },
    folderState: { folders: [{ id: "saved-folder" }] },
    FOLDER_MANAGER_ID: "chatgpt-toolkit-folder-manager",
    getComputedStyle: () => ({ overflowY: "auto" }),
    t: (key, params) => `${key}${params?.count === undefined ? "" : `:${params.count}`}`,
    setTimeout: (callback) => {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  };
  vm.runInNewContext(
    `${source}\nglobalThis.folderTest = { preloadFolderConversations, getState: () => ({ status: folderLoadStatus, active: !!folderPreloadSession }) };`,
    sandbox,
  );
  const advance = () => {
    const [id, callback] = timers.entries().next().value || [];
    assert.ok(callback, "expected a pending load poll");
    timers.delete(id);
    callback();
  };
  let renderCount = 0;
  const start = () => sandbox.folderTest.preloadFolderConversations({
    anchor: { history, section },
    scrollRoot,
    render: () => {
      assert.equal(history.hasAttribute("data-toolkit-folder-loading"), true);
      renderCount += 1;
    },
  });
  return {
    ...sandbox.folderTest, history, section, scrollRoot, manager, label, button, appendRow,
    advance, start, timers, get renderCount() { return renderCount; },
  };
};

test("does not load chats until the manual action is used", () => {
  const fixture = createFixture();
  assert.equal(fixture.timers.size, 0);
  assert.equal(fixture.scrollRoot.scrollTop, 0);
  assert.equal(fixture.history.hasAttribute("data-toolkit-folder-loading"), false);
});

test("manual loading blurs the list, classifies the final batch, then restores it", () => {
  const fixture = createFixture();
  fixture.start();
  assert.equal(fixture.getState().status, "loading");
  assert.equal(fixture.history.hasAttribute("data-toolkit-folder-loading"), true);
  assert.equal(fixture.manager.hasAttribute("data-toolkit-folder-loading-manager"), true);
  assert.equal(fixture.button.textContent, "folder.cancelLoad");
  assert.equal(fixture.scrollRoot.scrollTop, fixture.scrollRoot.scrollHeight);

  fixture.appendRow();
  fixture.advance();
  fixture.section.loading = false;
  fixture.advance();
  fixture.advance();
  fixture.advance();
  fixture.advance();
  fixture.advance();

  assert.equal(fixture.renderCount, 1);
  assert.equal(fixture.getState().status, "complete");
  assert.equal(fixture.history.hasAttribute("data-toolkit-folder-loading"), false);
  assert.equal(fixture.manager.hasAttribute("data-toolkit-folder-loading-manager"), false);
  assert.equal(fixture.scrollRoot.scrollTop, 0);
  assert.equal(fixture.label.textContent, "folder.managerLoaded:3");
  assert.equal(fixture.timers.size, 0);
});

test("the same button cancels loading and removes the blur", () => {
  const fixture = createFixture();
  fixture.start();
  fixture.start();
  assert.equal(fixture.getState().status, "idle");
  assert.equal(fixture.history.hasAttribute("data-toolkit-folder-loading"), false);
  assert.equal(fixture.scrollRoot.scrollTop, 0);
  assert.equal(fixture.timers.size, 0);
});

test("an interrupted load exposes a retry button", () => {
  const fixture = createFixture();
  fixture.start();
  fixture.history.isConnected = false;
  fixture.advance();

  assert.equal(fixture.getState().status, "failed");
  assert.equal(fixture.history.hasAttribute("data-toolkit-folder-loading"), false);
  assert.equal(fixture.manager.hasAttribute("data-toolkit-folder-loading-manager"), false);
  assert.equal(fixture.button.textContent, "folder.retryLoad");
  assert.equal(fixture.timers.size, 0);
});
