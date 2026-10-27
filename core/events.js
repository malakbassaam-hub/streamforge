import { sanitizeChatText } from "./safety.js";

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

export function createEventHandler(voteManager, publish) {
  return (input) => {
    const event = normalizeEvent(input);
    if (event.type === "chat.message") {
      voteManager.handleChatMessage(event.user, event.text);
    }
    publish(event);
  };
}
