import fs from "node:fs";
import path from "node:path";

const EVENT_TYPES = new Set(["chat.message", "raid", "vote.update", "vote.result"]);
const POSITIONS = new Set(["top-left", "top-right", "bottom-left", "bottom-right"]);
const PLUGIN_NAME = /^[a-z0-9][a-z0-9-]*$/;

function isRegularFile(filePath) {
  try {
    return fs.lstatSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isValidManifest(manifest, directoryName) {
  return manifest
    && typeof manifest === "object"
    && !Array.isArray(manifest)
    && typeof manifest.name === "string"
    && manifest.name === directoryName
    && typeof manifest.description === "string"
    && Array.isArray(manifest.subscribes)
    && manifest.subscribes.every((type) => typeof type === "string" && EVENT_TYPES.has(type))
    && Number.isInteger(manifest.width)
    && manifest.width > 0
    && manifest.width <= 2000
    && Number.isInteger(manifest.height)
    && manifest.height > 0
    && manifest.height <= 2000
    && POSITIONS.has(manifest.position);
}

export function scanPlugins(pluginsDirectory) {
  let entries;
  try {
    entries = fs.readdirSync(pluginsDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const plugins = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !PLUGIN_NAME.test(entry.name)) continue;

    const pluginDirectory = path.join(pluginsDirectory, entry.name);
    const manifestPath = path.join(pluginDirectory, "manifest.json");
    const pluginHtmlPath = path.join(pluginDirectory, "plugin.html");
    if (!isRegularFile(manifestPath) || !isRegularFile(pluginHtmlPath)) continue;

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (!isValidManifest(manifest, entry.name)) continue;

      plugins.push({
        name: manifest.name,
        description: manifest.description,
        subscribes: [...manifest.subscribes],
        width: manifest.width,
        height: manifest.height,
        position: manifest.position,
      });
    } catch {
      continue;
    }
  }

  return plugins;
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
