import { createEventSub } from "./eventsub-client.js";
export { createEventSub } from "./eventsub-client.js";
let client;
export function startEventSub(options) {
  if (!client) client = createEventSub(options);
  return client;
}
