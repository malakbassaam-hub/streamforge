# StreamForge Agent Guidelines & Architecture

## Overview
StreamForge is a modular, AI-powered interactive platform for Twitch creators using OpenAI Codex and local Node.js architecture.

## Architecture
- **Server**: Local Node.js server handling routing, API endpoints, and WebSocket/EventSub integration.
- **Overlay**: Browser-based OBS overlays served locally.
- /plugins/<name>/: manifest.json, plugin.html (single self-contained HTML file). Plugins run inside a sandboxed iframe in the overlay and receive events only via postMessage. They never touch the server.
- **Safety Layer**: Trims and truncates chat text to 200 characters before vote processing and rendering. A real content filter is planned.
- **Demo Mode**: Built-in simulation mode for testing overlays without active live streams.