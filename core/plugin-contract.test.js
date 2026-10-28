import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { scanPluginStatus } from "./plugins.js";

const directory = fileURLToPath(new URL("../plugins", import.meta.url));

test("all shipped plugin contracts are valid, self-contained and free of lint warnings", () => {
  const status = scanPluginStatus(directory);
  assert.deepEqual(status.invalid, []);
  assert.ok(status.valid.length > 0);
  for (const plugin of status.valid) {
    assert.deepEqual(plugin.warnings, [], plugin.name);
    const html = fs.readFileSync(path.join(directory, plugin.name, "plugin.html"), "utf8");
    assert.match(html, /html\s*,\s*body\s*\{\s*background:\s*transparent/, plugin.name);
    assert.match(html, /dir="auto"|\.dir\s*=\s*"auto"/, plugin.name);
    assert.doesNotMatch(html, /\b(?:localStorage|sessionStorage|indexedDB)\b|document\.cookie/, plugin.name);
  }
});

test("all shipped plugins ignore non-parent messages and safely accept themes and empty data", () => {
  for (const plugin of scanPluginStatus(directory).valid) {
    const html = fs.readFileSync(path.join(directory, plugin.name, "plugin.html"), "utf8");
    const properties = new Map();
    const nodes = new Map();
    function node() {
      return { textContent: "", children: [], replaceChildren() { this.children = []; }, append(child) { this.children.push(child); } };
    }
    const parent = {};
    let listener;
    const context = vm.createContext({
      parent,
      window: { addEventListener(type, callback) { assert.equal(type, "message"); listener = callback; } },
      document: {
        documentElement: { style: { setProperty(key, value) { properties.set(key, value); } } },
        querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); },
        createElement: node, createTextNode: text => ({ textContent: text }),
      },
      setInterval() {}, setTimeout() {}, clearTimeout() {},
    });
    vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], context);
    assert.equal(typeof listener, "function", plugin.name);
    listener({ source: {}, data: { type: "theme", tokens: { accent: "red" } } });
    assert.equal(properties.size, 0, plugin.name);
    listener({ source: parent, data: { type: "theme", tokens: { accent: "green" } } });
    assert.equal(properties.get("--accent"), "green", plugin.name);
    for (const data of [null, {}, { type: "chat.message" }, { type: "recap.card", lines: [] }]) {
      assert.doesNotThrow(() => listener({ source: parent, data }), plugin.name);
    }
  }
});
