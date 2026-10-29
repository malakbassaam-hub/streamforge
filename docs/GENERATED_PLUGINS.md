# Generated plugins

## Hype meter

The `hype-meter` plugin displays a chat activity bar with three levels and a five-second raid celebration.

### Files and placement

- [manifest.json](../plugins/hype-meter/manifest.json): plugin metadata and subscriptions.
- [plugin.html](../plugins/hype-meter/plugin.html): self-contained HTML, CSS, and JavaScript.
- Position: `top-left`.
- Requested size: 480 × 80 pixels, clamped to the overlay slot.
- Subscriptions: `chat.message` and `raid`; theme tokens arrive automatically from the overlay.

Only the first valid plugin assigned to a slot appears. Use the Forge Kit section of `/control` to check slot conflicts and plugin validation.

### Chat activity

The meter counts non-empty chat messages received during the last 60 seconds, using sixty one-second buckets. It refreshes every 250 milliseconds, so activity naturally drops as older messages expire.

| Messages per minute | Level | Bar |
| --- | --- | --- |
| 0–9 | Chill | Fills toward 30 messages/min |
| 10–29 | Warming up | Fills toward 30 messages/min |
| 30 or more | HYPE | Full |

The displayed count can exceed 30 even though the bar caps at full. Pure vote commands are routed separately by the overlay and are not counted by this plugin. The server consumes `!recap` commands before they reach the chat stream.

Counts begin when the plugin receives events; previous chat history is not replayed to plugins. Reloading the overlay resets the meter.

### Raid burst

A `raid` event fills the bar, sets the level to **HYPE**, and displays `<raider> brought <viewers> viewers!` for five seconds. A new raid restarts that five-second window. The displayed chat count remains the actual chat rate, and the meter returns to its current chat-based level afterward.

Missing raider names fall back to `A raider`. Invalid viewer counts fall back to zero. Raider names are trimmed and limited to 80 characters; text is rendered with `textContent`.

### Styling and safety

The plugin uses the overlay's `accent`, `surface`, `text`, `muted`, `border`, `accentSoft`, `fontFamily`, and `fontSmall` theme tokens. Its background is transparent, text supports automatic direction, and reduced-motion preferences disable the burst animation and bar transition.

Events are accepted only through `window.addEventListener("message")` when `event.source === parent`. The plugin makes no network requests, loads no external assets, and uses no persistent storage. The existing scripts-only sandbox and plugin CSP remain unchanged.

### Try it

1. Start StreamForge and open `/control` and `/overlay`.
2. Confirm `hype-meter` is valid and its `top-left` slot is available.
3. Click **Run overlay test** in Forge Kit. Its 12 chat messages should move the meter from Chill to Warming up; its raid should trigger the five-second burst.
4. Send 30 non-empty chat messages within a minute to reach HYPE through chat activity alone. Stop sending messages and watch the rate fall as the messages expire.

The Forge test endpoint has a global five-second cooldown. `DEMO=1` also provides simulated chat and raids for ongoing testing without a live stream.

### Validation

At creation, all 47 existing tests passed. Additional focused runtime checks passed for the level thresholds, chat expiry, five-second raid duration, and rejection of messages from non-parent sources.
