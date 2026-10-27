import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { scanPlugins } from "./plugins.js";

test("hello2 has a matching manifest and is discoverable", () => {
  const plugins = scanPlugins(fileURLToPath(new URL("../plugins", import.meta.url)));
  assert.ok(plugins.some(plugin => plugin.name === "hello2"));
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
