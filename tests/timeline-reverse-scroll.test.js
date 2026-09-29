const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const source = ["utils/dom.js", "features/virtualized-jump.js", "features/timeline.js"]
  .map((file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8"))
  .join("\n");

const createFixture = (flexDirection) => {
  class Element {}
  const root = new Element();
  root.scrollTop = 0;
  root.scrollHeight = 2000;
  root.clientHeight = 600;
  root.getBoundingClientRect = () => ({ top: 0, bottom: 600, height: 600 });
  root.scrollTo = ({ top }) => { root.scrollTop = top; };

  const main = new Element();
  main.querySelector = (selector) =>
    selector === '[data-app-action-timeline-scroll]' ? root : null;
  const document = {
    querySelector: (selector) => selector === "main" ? main : null,
    scrollingElement: null,
    documentElement: null,
    body: null,
  };
  const window = {
    getComputedStyle: () => ({ flexDirection }),
  };
  const sandbox = { HTMLElement: Element, document, window };
  vm.runInNewContext(
    `${source}\nglobalThis.scrollTest = { scrollElementIntoConversationView, getVirtualJumpScrollController, getConversationScrollController, getTimelineViewportMetrics };`,
    sandbox,
  );
  return { ...sandbox.scrollTest, root, Element };
};

test("reverse timeline coordinates move from newest to older messages", () => {
  const fixture = createFixture("column-reverse");
  const controller = fixture.getVirtualJumpScrollController();
  assert.equal(controller.getMaxTop(), 1400);
  assert.equal(controller.getTop(), 1400);

  controller.setTop(0);
  assert.equal(fixture.root.scrollTop, -1400);
  assert.equal(controller.getTop(), 0);

  controller.setTop(700);
  assert.equal(fixture.root.scrollTop, -700);
  assert.equal(controller.getTop(), 700);
  assert.equal(fixture.getConversationScrollController().getTop(), 700);
  assert.equal(fixture.getTimelineViewportMetrics().top, 700);
});

test("direct message jumps permit a negative native scroll position", () => {
  const fixture = createFixture("column-reverse");
  const message = new fixture.Element();
  message.getBoundingClientRect = () => ({ top: -500, bottom: -100, height: 400 });

  fixture.scrollElementIntoConversationView(message, { behavior: "auto", block: "center" });
  assert.equal(fixture.root.scrollTop, -600);
});

test("ordinary scroll containers still use positive coordinates", () => {
  const fixture = createFixture("column");
  const controller = fixture.getVirtualJumpScrollController();
  controller.setTop(700);
  assert.equal(fixture.root.scrollTop, 700);

  const message = new fixture.Element();
  message.getBoundingClientRect = () => ({ top: 500, bottom: 900, height: 400 });
  fixture.scrollElementIntoConversationView(message, { behavior: "auto", block: "center" });
  assert.equal(fixture.root.scrollTop, 1100);
});
