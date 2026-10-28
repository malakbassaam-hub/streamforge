# Plugin format
1. Create `plugins/<name>/manifest.json` and `plugin.html`.
2. Use a lowercase folder name with letters, digits, and hyphens.
3. Manifest fields: `name`, `description`, `subscribes`, `width`, `height`, `position`.
4. `name` must match the plugin folder; dimensions are integers from 1 to 2000.
5. `position` is `top-left`, `top-right`, `bottom-right`, or `recap`. The overlay clamps dimensions to the slot, reserves a separate vote zone, and uses the first plugin in each slot.
6. Subscribe to `chat.message`, `raid`, `vote.update`, `vote.result`, `recap.card`, and/or `command`.
7. `plugin.html` must contain all HTML, CSS, and JavaScript inline; no external requests.
8. Plugins run in an iframe sandboxed with scripts only and a restrictive CSP.
9. Receive events with `window.addEventListener("message", ({data}) => { ... })`.
10. Messages are `{type, ...safeFields}`; chat has `user`, `text`, `ts`. Both chat and raid `ts` values are Unix time in milliseconds.
11. Raid has `user` (raiding channel name), `viewers`, `ts`; vote updates have `question`, `options`, `endsAt`.
12. Vote results have `winner` (string, string array for ties, or null), `question`, and `options`.
13. Only subscribed events are forwarded, and tokens or other fields are never sent.
14. After load, the overlay also sends `{type:"theme", tokens:{accent,surface,text,muted,border,accentSoft,fontFamily,fontSmall,fontBody,fontChat,fontOption,fontQuestion}}`.
15. Apply received token values in your plugin CSS to match the overlay theme.

16. Recap cards have `lines` (plain text string array) and `ts` (Unix milliseconds). They summarize retained events from the last 10 minutes, with a global 60-second cooldown. The current memory holds at most 100 events, so busy streams may retain less than ten minutes.

With `DEMO=1`, enter `!recap` in the control page's demo test box or POST to `/api/demo/recap`. Both demo endpoints require a localhost connection and share the chat command's cooldown. Recaps use templates only, without network or LLM calls.

17. Include `html,body{background:transparent}`. The overlay sets iframe `color-scheme: light` so default plugin canvases remain transparent in both OS themes.
18. Pure `!1`-`!4` (including Arabic-Indic digits) and `!recap`, when received by the overlay, are delivered only as `command` events (`user`, `text`, `ts`), never as `chat.message`. The server consumes real `!recap` chat commands to publish `recap.card`; those commands do not enter the overlay chat stream.
19. Frames start hidden until a subscribed event arrives; recap frames hide after 12 seconds. Empty frames never capture pointer input.

## Authoring checklist

Create only `plugins/<slug>/manifest.json` and `plugins/<slug>/plugin.html`. Keep CSS and JavaScript inline; do not use network requests, imports, external assets, cookies, localStorage, sessionStorage, or IndexedDB. Verify `event.source === parent` inside the message listener. Apply theme tokens, use `dir="auto"` and `textContent` for dynamic text, handle empty or missing data, respect `prefers-reduced-motion` for animations, and keep animated DOM nodes under approximately 30. Pick an available named slot; frames are clamped and cannot cover the reserved vote zone.

## Forge Kit

Open `/control` to inspect valid/invalid plugins, lint warnings, the live contract, and slot conflicts. Refresh after editing plugin files. Warnings are advisory and do not prevent loading; invalid manifests do. The first valid plugin in each slot occupies that slot.

`GET /api/forge/contract` returns this guide, the `AGENTS.md` authoring rules, and the shared event/position allowlists. `GET /api/plugins/status` returns `{valid, invalid}` with warnings on valid entries. `POST /api/forge/test` publishes labeled TEST chat, raid, and vote-result events locally over eight seconds, limited globally to once every five seconds (429 with `Retry-After`). Test events appear in the overlay and retained history, including the displayed vote result. No Twitch chat messages are sent.
