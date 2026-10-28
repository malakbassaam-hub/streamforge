# StreamForge

A local Node.js platform for Twitch chat, votes, OBS overlays, and sandboxed plugins. Recaps use plain templates; the application makes no LLM calls.

## Run a local demo

Use Node.js 24 (the tested runtime), run `npm ci`, set `DEMO=1` in `.env`, then run `npm start`. On PowerShell systems that block `npm.ps1`, use `npm.cmd`.

- Control panel: `http://127.0.0.1:3000/control`
- OBS Browser Source: `http://127.0.0.1:3000/overlay`, at 1920×1080 or 1280×720.
- Start a vote in the control panel: 2–4 options, question up to 120 characters, options up to 40 characters, duration 10–300 seconds. Viewers vote with `!1`–`!4`, including Arabic-Indic digits.
- Enter `!recap` in the demo test box to show retained activity from the last ten minutes (up to 100 stored events). Recaps have a shared 60-second cooldown.
- Use Forge Kit to inspect plugin status and the authoring contract. **Run overlay test** emits 12 bilingual chat messages, one raid, and one vote result over eight seconds; it works without Twitch and has a five-second cooldown.

`DEMO=0` disables simulation. If `DEMO` is unset, simulated chat/raids run, but simulated voting and the recap test endpoints require `DEMO=1`. With real Twitch credentials, connect through `/auth/twitch`; authentication is not part of the offline demo verification.

## Local security boundary

The default bind address is `127.0.0.1`; `HOST` and `PORT` override binding. Requests must have a localhost, 127.0.0.1, or [::1] Host header. Administrative Forge/demo/vote endpoints also enforce a loopback socket address. Keep the default bind for demos: this is not an authenticated public hosting configuration.

Plugins receive allowlisted fields via postMessage, use scripts-only sandboxing, and retain the restrictive plugin CSP. See [plugin rules](plugins/README.md) and [agent guidelines](AGENTS.md). Chat safety currently trims and truncates text; a moderation filter is planned.

## Validation

Run `npm test` (or `npm.cmd test`). This covers backend/frontend behavior, contracts, plugin validation, sandbox attributes/CSP, Host/loopback checks, cooldowns, snapshots, recaps, and slot geometry at both OBS resolutions.

For headless Chrome visual checks on Windows, run `node tools/verify-overlay.mjs after`. It uses an isolated fixture server, light/dark color-scheme emulation, and a temporary magenta background. Screenshots and measurements are saved under `artifacts/overlay-check`; production stays transparent. Live Twitch connectivity and an actual OBS capture still need a local smoke test before a live broadcast.
