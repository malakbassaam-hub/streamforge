import { sanitizeChatText } from "./safety.js";
import { isRecapCommand } from "./recap.js";

export function normalizeEvent(event) {
  const ts = Number.isFinite(event.ts) ? event.ts : Date.now();
  const user = typeof event.user === "string" ? event.user : "";
  if (event.type === "chat.message") {
    return { type: event.type, user, text: sanitizeChatText(event.text), ts };
  }
  if (event.type === "raid") {
    return { type: event.type, user, viewers: event.viewers, ts };
  }
  return event;
}

export function createEventHandler(voteManager, publish, onRecap) {
  return (input) => {
    const event = normalizeEvent(input);
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
