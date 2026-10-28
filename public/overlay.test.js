import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";

function loadOverlay() {
  const nodes = new Map();
  const timers = [];
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
      attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; }, addEventListener() {},
      contentWindow: { postMessage() {} },
      get firstElementChild() { return this.children[0]; },
    };
  }
  const context = vm.createContext({
    document: { querySelector: selector => {
      if (!nodes.has(selector)) nodes.set(selector, node());
      return nodes.get(selector);
    }, createElement: node, createTextNode: text => ({ textContent: text }) },
    window: { addEventListener() {} }, innerWidth: 1920, innerHeight: 1080,
    EventSource: class {}, fetch: async () => ({ ok: true, json: async () => [] }),
    setInterval() {}, clearInterval() {}, setTimeout(fn, delay) { timers.push({ fn, delay }); }, clearTimeout() {},
    requestAnimationFrame() {}, Date, console,
  });
  const html = fs.readFileSync(new URL("./overlay.html", import.meta.url), "utf8");
  vm.runInContext(fs.readFileSync(new URL("./overlay-utils.js", import.meta.url), "utf8").replaceAll("export ", ""), context);
  vm.runInContext(html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/import .*?;\n/, ""), context);
  return { nodes, timers, createFrame: plugin => context.createPluginFrame(plugin), send: event => context.handleOverlayEvent(event) };
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

test("plugins receive commands only through explicit command subscriptions", () => {
  const { nodes, send } = loadOverlay();
  const chats = [];
  const commands = [];
  nodes.get("#plugin-layer").querySelectorAll = () => [
    { pluginManifest: { subscribes: ["chat.message"] }, contentWindow: { postMessage: event => chats.push(event) } },
    { pluginManifest: { subscribes: ["command"] }, contentWindow: { postMessage: event => commands.push(event) } },
  ];
  for (const text of ["!1", "!\u0664", "!RECAP"]) send({ type: "chat.message", user: "Viewer", text, ts: 123 });
  assert.equal(chats.length, 0);
  assert.equal(commands.length, 3);
  assert.ok(commands.every(event => event.type === "command" && event.ts === 123));
  send({ type: "chat.message", user: "Viewer", text: "!1 yes", ts: 124 });
  assert.equal(chats.length, 1);
  assert.equal(commands.length, 3);
});

test("plugin frames start collapsed, clamp to slots, and recap collapses after twelve seconds", () => {
  const { nodes, timers, createFrame, send } = loadOverlay();
  const layer = nodes.get("#plugin-layer");
  layer.querySelectorAll = () => layer.children;
  createFrame({ name: "recap", position: "recap", width: 2000, height: 2000, subscribes: ["recap.card"] });
  assert.equal(layer.children.length, 1);
  const frame = layer.children[0];
  assert.deepEqual(frame.attributes, { sandbox: "allow-scripts" });
  assert.equal(frame.hidden, true);
  assert.equal(frame.style.width, "520px");
  assert.equal(frame.style.height, "480px");
  createFrame({ name: "duplicate", position: "recap", width: 50, height: 50, subscribes: [] });
  assert.equal(layer.children.length, 1);
  send({ type: "recap.card", lines: ["Nothing happened yet"], ts: Date.now() });
  assert.equal(frame.hidden, false);
  timers.find(timer => timer.delay === 12_000).fn();
  assert.equal(frame.hidden, true);
});
