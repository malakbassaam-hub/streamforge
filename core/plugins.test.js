import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scanPlugins, scanPluginStatus, lintPluginHtml } from "./plugins.js";

test("hello2 is discoverable as a fixture but never as an overlay plugin", () => {
  const plugins = scanPlugins(fileURLToPath(new URL("../plugins", import.meta.url)));
  assert.ok(!plugins.some(plugin => plugin.name === "hello2"));
  const fixtures = scanPlugins(fileURLToPath(new URL("../tests/fixtures/plugins", import.meta.url)));
  assert.ok(fixtures.some(plugin => plugin.name === "hello2"));
});

test("manifest validation accepts only named slots and allows command subscriptions", context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-slots-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, "slot-test");
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, "plugin.html"), "<!doctype html>");
  for (const position of ["top-left", "top-right", "bottom-right", "recap", "bottom-left", "unknown"]) {
    fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
      name: "slot-test", description: "Slot validation", subscribes: ["command"], width: 100, height: 100, position,
    }));
    assert.equal(scanPlugins(root).length, ["bottom-left", "unknown"].includes(position) ? 0 : 1);
  }
});

test("recap plugin can subscribe to recap cards", () => {
  const plugins = scanPlugins(fileURLToPath(new URL("../plugins", import.meta.url)));
  assert.deepEqual(plugins.find(plugin => plugin.name === "recap")?.subscribes, ["recap.card"]);
});

test("plugin diagnostics explain invalid folders and keep warned plugins loadable", context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-diagnostics-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = name => ({ name, description: "Test", subscribes: ["chat.message"], width: 320, height: 100, position: "top-right" });
  function write(name, data, html = "<!doctype html>") {
    fs.mkdirSync(path.join(root, name));
    if (data !== undefined) fs.writeFileSync(path.join(root, name, "manifest.json"), typeof data === "string" ? data : JSON.stringify(data));
    if (html !== null) fs.writeFileSync(path.join(root, name, "plugin.html"), html);
  }
  write("bad-json", "{");
  write("mismatch", manifest("different"));
  write("missing-manifest", undefined);
  write("missing-html", manifest("missing-html"), null);
  write("BadSlug", manifest("BadSlug"));
  write("bad-events", { ...manifest("bad-events"), subscribes: [{ toString: null }] });
  const risky = 'fetch ("https://example.test"); new XMLHttpRequest(); new WebSocket("ws://example.test"); import("module"); <script src="x.js"></script><link href="x.css">';
  write("warned", manifest("warned"), risky);
  write("clean", manifest("clean"));
  const status = scanPluginStatus(root);
  const reasons = Object.fromEntries(status.invalid.map(({ folder, reason }) => [folder, reason]));
  assert.match(reasons["bad-json"], /Bad JSON/);
  assert.match(reasons.mismatch, /match folder/);
  assert.match(reasons["missing-manifest"], /manifest.json/);
  assert.match(reasons["missing-html"], /plugin.html/);
  assert.match(reasons.BadSlug, /slug/);
  assert.match(reasons["bad-events"], /allowed event/);
  assert.equal(status.valid.find(plugin => plugin.name === "warned").warnings.length, 7);
  assert.deepEqual(status.valid.find(plugin => plugin.name === "clean").warnings, []);
  assert.ok(scanPlugins(root).some(plugin => plugin.name === "warned"));
  assert.equal(lintPluginHtml('<!-- http://example.test -->').length, 1);
});

test("scanPlugins returns valid plugins and skips missing or invalid manifests", (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-plugins-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const validDirectory = path.join(root, "valid-plugin");
  fs.mkdirSync(validDirectory);
  fs.writeFileSync(path.join(validDirectory, "manifest.json"), JSON.stringify({
    name: "valid-plugin",
    description: "A valid test plugin",
    subscribes: ["chat.message", "vote.update"],
    width: 400,
    height: 200,
    position: "top-right",
  }));
  fs.writeFileSync(path.join(validDirectory, "plugin.html"), "<!doctype html>");

  const invalidDirectory = path.join(root, "invalid-plugin");
  fs.mkdirSync(invalidDirectory);
  fs.writeFileSync(path.join(invalidDirectory, "manifest.json"), "{invalid");
  fs.writeFileSync(path.join(invalidDirectory, "plugin.html"), "<!doctype html>");

  const missingHtmlDirectory = path.join(root, "missing-html");
  fs.mkdirSync(missingHtmlDirectory);
  fs.writeFileSync(path.join(missingHtmlDirectory, "manifest.json"), JSON.stringify({
    name: "missing-html",
    description: "No plugin document",
    subscribes: [],
    width: 100,
    height: 100,
    position: "bottom-left",
  }));

  assert.deepEqual(scanPlugins(root), [{
    name: "valid-plugin",
    description: "A valid test plugin",
    subscribes: ["chat.message", "vote.update"],
    width: 400,
    height: 200,
    position: "top-right",
  }]);
  assert.deepEqual(scanPlugins(path.join(root, "does-not-exist")), []);
});
