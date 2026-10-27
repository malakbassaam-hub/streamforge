# Plugin format
1. Create `plugins/<name>/manifest.json` and `plugin.html`.
2. Use a lowercase folder name with letters, digits, and hyphens.
3. Manifest fields: `name`, `description`, `subscribes`, `width`, `height`, `position`.
4. `name` must match the plugin folder; dimensions are integers from 1 to 2000.
5. `position` is `top-left`, `top-right`, `bottom-left`, or `bottom-right`.
6. Subscribe to `chat.message`, `raid`, `vote.update`, `vote.result`, and/or `recap.card`.
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
