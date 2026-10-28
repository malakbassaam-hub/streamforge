import { SLOT_NAMES, EVENT_FIELDS } from "../public/overlay-utils.js";
import fs from "node:fs";
import path from "node:path";

const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]*$/;

export function lintPluginHtml(html) {
  return [
    [/\bfetch\s*\(/i, "fetch() may make network requests"],
    [/\bXMLHttpRequest\b/i, "XMLHttpRequest is not allowed"],
    [/\bWebSocket\b/i, "WebSocket is not allowed"],
    [/\bimport\s*\(/i, "Dynamic import() requires external code"],
    [/<script\b[^>]*\bsrc\s*=/i, "External script src is not allowed"],
    [/<link\b[^>]*\bhref\s*=/i, "External link href is not allowed"],
    [/https?:\/\//i, "HTTP/HTTPS URL found"],
  ].filter(([pattern]) => pattern.test(html)).map(([, warning]) => warning);
}

function manifestError(manifest, folder) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return "Manifest must be an object";
  if (manifest.name !== folder) return "Manifest name must match folder name";
  if (typeof manifest.description !== "string") return "description must be a string";
  if (!Array.isArray(manifest.subscribes) || !manifest.subscribes.every(type => typeof type === "string" && Object.hasOwn(EVENT_FIELDS, type))) return "subscribes must contain only allowed event types";
  for (const key of ["width", "height"]) {
    if (!Number.isInteger(manifest[key]) || manifest[key] < 1 || manifest[key] > 2000) return key + " must be an integer from 1 to 2000";
  }
  if (!SLOT_NAMES.includes(manifest.position)) return "position must be a named slot: " + SLOT_NAMES.join(", ");
  return null;
}

export function scanPluginStatus(pluginsDirectory) {
  const valid = [], invalid = [];
  let entries;
  try { entries = fs.readdirSync(pluginsDirectory, { withFileTypes: true }); }
  catch { return { valid, invalid }; }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folder = entry.name;
    const reject = reason => invalid.push({ folder, reason });
    if (!PLUGIN_NAME.test(folder)) { reject("Folder must be a lowercase slug using letters, digits and hyphens"); continue; }
    const directory = path.join(pluginsDirectory, folder);
    let missing;
    for (const name of ["manifest.json", "plugin.html"]) {
      try { if (!fs.lstatSync(path.join(directory, name)).isFile()) missing = name; }
      catch { missing = name; }
      if (missing) break;
    }
    if (missing) { reject("Missing or non-regular file: " + missing); continue; }
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")); }
    catch { reject("Bad JSON or unreadable manifest.json"); continue; }
    const reason = manifestError(manifest, folder);
    if (reason) { reject(reason); continue; }
    let html;
    try { html = fs.readFileSync(path.join(directory, "plugin.html"), "utf8"); }
    catch { reject("Unreadable plugin.html"); continue; }
    valid.push({ name: manifest.name, description: manifest.description, subscribes: [...manifest.subscribes],
      width: manifest.width, height: manifest.height, position: manifest.position, warnings: lintPluginHtml(html) });
  }
  return { valid, invalid };
}

// Preserve the existing loadable-plugin API; diagnostics are available separately.
export function scanPlugins(pluginsDirectory) {
  return scanPluginStatus(pluginsDirectory).valid.map(({ warnings, ...plugin }) => plugin);
}

export function watchPlugins(pluginsDirectory, onChange, debounceMilliseconds = 150) {
  let watchers = [];
  let debounceTimer;
  let closed = false;

  function refreshWatchers() {
    for (const watcher of watchers) watcher.close();
    watchers = [];

    let pluginDirectories;
    try {
      pluginDirectories = fs.readdirSync(pluginsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && PLUGIN_NAME.test(entry.name))
        .map((entry) => path.join(pluginsDirectory, entry.name));
    } catch (error) {
      console.error(`Unable to watch plugin folders: ${error.message}`);
      pluginDirectories = [];
    }

    for (const directory of [pluginsDirectory, ...pluginDirectories]) {
      try {
        const watcher = fs.watch(directory, () => {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(() => {
            if (closed) return;
            refreshWatchers();
            onChange();
          }, debounceMilliseconds);
        });
        watcher.on("error", (error) => {
          console.error(`Plugin watcher error for ${directory}: ${error.message}`);
        });
        watchers.push(watcher);
      } catch (error) {
        console.error(`Unable to watch plugin folder ${directory}: ${error.message}`);
      }
    }
  }

  try {
    fs.mkdirSync(pluginsDirectory, { recursive: true });
    refreshWatchers();
  } catch (error) {
    console.error(`Unable to initialize plugin watcher: ${error.message}`);
  }

  return {
    close() {
      closed = true;
      clearTimeout(debounceTimer);
      for (const watcher of watchers) watcher.close();
      watchers = [];
    },
  };
}
