import { sanitizeChat, createChatFilter } from "./safety.js";
import { isRecapCommand } from "./recap.js";

export function normalizeEvent(event, filter) {
  const ts = Number.isFinite(event.ts) ? event.ts : Date.now();
  const user = typeof event.user === "string" ? event.user : "";
  if (event.type === "chat.message") {
    const result = filter ? filter.sanitizeChat(event.text, user) : sanitizeChat(event.text);
    if (result.flagged) return null;
    return { type: event.type, user, text: result.text, ts };
  }
  if (event.type === "raid") {
    return { type: event.type, user, viewers: event.viewers, ts };
  }
  return event;
}

export function createEventHandler(voteManager, publish, onRecap, filter = createChatFilter()) {
  return (input) => {
    const event = normalizeEvent(input, filter);
    if (!event) return;
    if (event.type === "chat.message") {
      if (isRecapCommand(event.text)) {
        onRecap?.();
        return;
      }
      voteManager.handleChatMessage(event.user, event.text);
    }
    publish(event);
  };
}
