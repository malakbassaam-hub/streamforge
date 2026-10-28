# Overlay browser verification

Run `node tools/verify-overlay.mjs after` with local Chrome installed. This uses an isolated local fixture server, without OAuth, Twitch, or environment secrets. Chrome emulates light and dark OS color-scheme preferences at both requested viewport sizes. The magenta background exists only in the verification page and is removed before closing it; production CSS remains transparent.

Before screenshots reproduce white iframe canvases and plugin/vote overlap. After screenshots show magenta through the empty plugin canvases, including below plugin cards. Idle recap iframes have a zero-size rectangle (`hidden`). Active recap screenshots show the relative time, omitted empty vote line, and 24px body font.

| Viewport | Light vote size | Dark vote size | Internal scrolling |
| --- | --- | --- | --- |
| 1920×1080 | 560 × 472.3125px | 560 × 472.3125px | No |
| 1280×720 | 560 × 472.3125px | 560 × 472.3125px | No |

The open vote has four long options, with a 34px question and 26px option labels. At 720p, the top-right slot ends at y=104, the vote starts at y=120 and ends at y=592.3125, and the bottom-right slot starts at y=616. At 1080p, those boundaries are y=144, y=160–632.3125, and y=936. The left slots and recap slot occupy a separate column. Full rectangles are in `after-measurements.json`.

Small plugin documents exceeding their slot height are clamped and can scroll inside their frame. Longer vote questions or unusually large counts can also scroll within the reserved vote zone without overlapping plugin slots.
