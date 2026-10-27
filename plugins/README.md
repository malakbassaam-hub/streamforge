# Plugin format
1. Create `plugins/<name>/manifest.json` and `plugin.html`.
2. Use a lowercase folder name with letters, digits, and hyphens.
3. Manifest fields: `name`, `description`, `subscribes`, `width`, `height`, `position`.
4. `name` must match the plugin folder; dimensions are integers from 1 to 2000.
5. `position` is `top-left`, `top-right`, `bottom-left`, or `bottom-right`.
6. Subscribe to `chat.message`, `raid`, `vote.update`, and/or `vote.result`.
7. `plugin.html` must contain all HTML, CSS, and JavaScript inline; no external requests.
8. Plugins run in an iframe sandboxed with scripts only and a restrictive CSP.
9. Receive events with `window.addEventListener("message", ({data}) => { ... })`.
10. Messages are `{type, ...safeFields}`; chat has `user`, `text`, `ts`.
11. Raid has `user`, `viewers`, `timestamp`; vote updates have `question`, `options`, `endsAt`.
12. Vote results have `winner` (string, string array for ties, or null) and `options`.
13. Only subscribed events are forwarded, and tokens or other fields are never sent.
14. After load, the overlay also sends `{type:"theme", tokens:{accent,surface,text,muted,border,accentSoft,fontFamily,fontSmall,fontBody,fontChat,fontOption,fontQuestion}}`.
15. Apply received token values in your plugin CSS to match the overlay theme.
