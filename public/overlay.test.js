import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

function loadOverlay() {
  const nodes = new Map();
  function node() {
    const classes = new Set();
    return {
      children: [], style: {}, hidden: true,
      classList: { add: value => classes.add(value), remove: value => classes.delete(value),
        toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) },
      append(...items) { this.children.push(...items); },
      prepend(item) { this.children.unshift(item); },
      replaceChildren(...items) { this.children = items; },
      querySelectorAll() { return []; },
      get firstElementChild() { return this.children[0]; },
    };
  }
  const context = vm.createContext({
    document: { querySelector: selector => {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    }, createElement: node, createTextNode: text => ({ textContent: text }) },
    EventSource: class {}, fetch: async () => ({ ok: true, json: async () => [] }),
    setInterval() {}, clearInterval() {}, setTimeout() {}, clearTimeout() {},
    requestAnimationFrame() {}, Date, console,
  });
  const html = fs.readFileSync(new URL("./overlay.html", import.meta.url), "utf8");
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
  return { nodes, send: event => context.handleOverlayEvent(event) };
}

test("overlay restores snapshots, filters only pure vote commands, and reflects source status", () => {
  const { nodes, send } = loadOverlay();
  const vote = { type: "vote.update", question: "Pick", options: [{ label: "A", count: 1 }, { label: "B", count: 0 }], endsAt: Date.now() + 30_000 };
  send({ type: "snapshot", vote, chat: [{ type: "chat.message", user: "Viewer", text: "Hello" }], status: { live: false, demo: true } });
  assert.equal(nodes.get("#vote-card").hidden, false);
  assert.equal(nodes.get("#vote-question").textContent, "Pick");
  assert.equal(nodes.get("#status").textContent, "Demo");
  const forwarded = [];
  nodes.get("#plugin-layer").querySelectorAll = () => [{
    pluginManifest: { subscribes: ["recap.card"] },
    contentWindow: { postMessage: event => forwarded.push(event) },
  }];
  send({ type: "recap.card", lines: ["Recap", "Nothing happened yet"], ts: 123, secret: "hidden" });
  assert.equal(JSON.stringify(forwarded), JSON.stringify([
    { type: "recap.card", lines: ["Recap", "Nothing happened yet"], ts: 123 },
  ]));
  assert.equal(nodes.get("#feed").children.length, 1);
  for (const text of ["!1", " !4 ", "!\u0661", "!\u0664"]) send({ type: "chat.message", user: "Viewer", text });
  assert.equal(nodes.get("#feed").children.length, 1);
  send({ type: "chat.message", user: "Viewer", text: "!1 yes" });
  assert.equal(nodes.get("#feed").children.length, 2);
  send({ type: "status", live: true, demo: true });
  assert.equal(nodes.get("#status").textContent, "Live");
  send({ type: "vote.result", winner: "A", options: vote.options });
  send({ type: "chat.message", user: "Viewer", text: "!2" });
  assert.equal(nodes.get("#feed").children.length, 3);
  send({ type: "snapshot", vote: null, chat: [], status: { live: false, demo: false } });
  assert.equal(nodes.get("#feed").children.length, 0);
  assert.equal(nodes.get("#vote-card").hidden, true);
  assert.equal(nodes.get("#status").textContent, "Offline");
});
