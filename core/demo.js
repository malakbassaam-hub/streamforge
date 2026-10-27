import { EventEmitter } from "node:events";

const chatters = ["PixelPilot", "MapleByte", "OrbitFox", "LunaBuilds"];
const voters = ["DemoViewer1", "DemoViewer2", "DemoViewer3", "DemoViewer4"];
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

export function createDemoSimulator({ isVoteOpen, onDemoVote } = {}) {
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
        ts: Date.now(),
      });
      return;
    }

    events.emit("event", {
      type: "chat.message",
      user: pick(chatters),
      text: pick(chatMessages),
      ts: Date.now(),
    });

    if (onDemoVote && isVoteOpen?.()) {
      onDemoVote(pick(voters), `!${Math.floor(Math.random() * 2) + 1}`);
    }
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