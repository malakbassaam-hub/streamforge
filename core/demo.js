import { EventEmitter } from "node:events";
import { sanitizeChatText } from "./safety.js";

const chatters = ["PixelPilot", "MapleByte", "OrbitFox", "LunaBuilds"];
const chatMessages = [
  "That was a great play!",
  "Hello from demo mode!",
  "The overlay is looking sharp.",
  "One more round!",
];
const raiders = ["CozyCircuit", "NovaNook", "FernRunner"];

function pick(items) {
  return items[Math.floor(Math.random() * items.length)];
}

export function createDemoSimulator() {
  const events = new EventEmitter();
  let interval;
  let eventCount = 0;

  function emitDemoEvent() {
    eventCount += 1;

    if (eventCount % 4 === 0) {
      events.emit("event", {
        type: "raid",
        user: pick(raiders),
        viewers: Math.floor(Math.random() * 91) + 10,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    events.emit("event", {
      type: "chat",
      user: pick(chatters),
      text: sanitizeChatText(pick(chatMessages)),
      timestamp: new Date().toISOString(),
    });
  }

  return {
    events,
    start() {
      if (!interval) {
        interval = setInterval(emitDemoEvent, 3000);
      }
    },
    stop() {
      clearInterval(interval);
      interval = undefined;
    },
  };
}