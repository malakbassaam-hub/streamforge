export function sanitizeChatText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, 200);
}