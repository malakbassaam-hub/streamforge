export const SLOT_NAMES = ["top-left", "top-right", "bottom-right", "recap"];

export const EVENT_FIELDS = {
  "chat.message": ["type", "user", "text", "ts"],
  raid: ["type", "user", "viewers", "ts"],
  "vote.update": ["type", "question", "options", "endsAt"],
  "vote.result": ["type", "question", "winner", "options"],
  "recap.card": ["type", "lines", "ts"],
  command: ["type", "user", "text", "ts"],
};

export function forwardedEvent(event) {
  const command = commandText(event);
  const input = command ? { ...event, type: "command", text: command } : event;
  const fields = Object.hasOwn(EVENT_FIELDS, input.type) ? EVENT_FIELDS[input.type] : null;
  if (!fields) return null;
  const result = Object.fromEntries(fields.map(field => [field, input[field]]));
  if (Array.isArray(result.options)) result.options = result.options.map(({ label, count }) => ({ label, count }));
  if (result.type === "recap.card") result.lines = recapLines(result.lines, result.ts);
  return result;
}

export function layoutSlots(width, height) {
  const margin = 24;
  const column = Math.min(560, width / 2 - 36);
  const smallHeight = height >= 900 ? 120 : 80;
  const leftWidth = Math.min(520, width / 2 - 48);
  return {
    "top-left": { x: margin, y: 72, width: leftWidth, height: smallHeight },
    "top-right": { x: width - margin - column, y: margin, width: column, height: smallHeight },
    "bottom-right": { x: width - margin - column, y: height - margin - smallHeight, width: column, height: smallHeight },
    recap: { x: margin, y: 88 + smallHeight, width: leftWidth, height: Math.min(480, height - smallHeight - 300) },
    vote: { x: width - margin - column, y: margin + smallHeight + 16,
      width: column, height: height - 2 * (margin + smallHeight + 16) },
  };
}

export function clampToSlot(plugin, slots) {
  const slot = SLOT_NAMES.includes(plugin.position) ? slots[plugin.position] : null;
  if (!slot) return null;
  return { x: slot.x, y: slot.y, width: Math.min(plugin.width, slot.width), height: Math.min(plugin.height, slot.height) };
}

export function commandText(event) {
  if (event.type !== "chat.message") return null;
  const text = String(event.text ?? "").trim();
  return /^(?:![1-4\u0661-\u0664]|!recap)$/i.test(text) ? text : null;
}

// Presentation-only conversion keeps the server's recap format backward compatible.
export function recapLines(lines, ts) {
  return lines.filter(line => typeof line === "string" && !/^Recap: last 10 minutes$/.test(line)
    && !/: none$/.test(line) && !/^Chat: 0 messages/.test(line)).map(line => {
    return line.replace(/(\d{2}):(\d{2}) UTC/, (_, hours, minutes) => {
      const reference = new Date(ts);
      let peak = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate(), Number(hours), Number(minutes));
      if (peak > ts) peak -= 86_400_000;
      return `${Math.max(0, Math.floor((ts - peak) / 60_000))} min ago`;
    });
  });
}
