# StreamForge Agent Guidelines & Architecture

## Overview
StreamForge is a modular, AI-powered interactive platform for Twitch creators using OpenAI Codex and local Node.js architecture.

## Architecture
- **Server**: Local Node.js server handling routing, API endpoints, and WebSocket/EventSub integration.
- **Overlay**: Browser-based OBS overlays served locally.
- /plugins/<name>/: manifest.json, plugin.html (single self-contained HTML file). Plugins run inside a sandboxed iframe in the overlay and receive events only via postMessage. They never touch the server.
- **Safety Layer**: Trims and truncates chat text to 200 characters before vote processing and rendering. A real content filter is planned.
- **Demo Mode**: Built-in simulation mode for testing overlays without active live streams.
## Plugin authoring rules
- Include `html,body{background:transparent}` in each self-contained plugin.
- Positions are named slots: `top-left`, `top-right`, `bottom-right`, `recap`; dimensions are clamped to the slot.
- The overlay reserves a separate vote zone and initially hides plugin frames until a subscribed event arrives. Recap frames collapse after 12 seconds.

- When creating a plugin, create ONLY `plugins/<slug>/manifest.json` and `plugins/<slug>/plugin.html`. Do not modify other files.
- Use a lowercase slug (letters, digits, hyphens); manifest `name` must exactly equal the folder name.
- Manifest fields are `name`, `description`, `subscribes`, `width`, `height`, `position`; dimensions are integers from 1 to 2000. Use the contract's event allowlist and named positions.
- Write one self-contained HTML document with inline CSS and JavaScript. No network requests, external files, imports, or storage (including cookies, localStorage, sessionStorage, IndexedDB).
- Receive events ONLY through `window.addEventListener("message", ...)`; verify `event.source === parent`. Never contact the server directly.
- Apply the supplied `theme` tokens for colors and typography. Use `dir="auto"` for dynamic text and `textContent` instead of HTML interpolation.
- Respect `prefers-reduced-motion`, handle empty/missing data gracefully, and keep animated DOM nodes under approximately 30.
- Choose an available named slot (small widgets: top-left/top-right/bottom-right; recap cards: recap). Stay within its clamped rectangle; never cover the reserved vote card zone.
- Keep `sandbox="allow-scripts"` only, never add `allow-same-origin`, and never change the plugin CSP.
