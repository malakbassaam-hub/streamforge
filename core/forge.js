import fs from "node:fs";
import path from "node:path";
import { EVENT_FIELDS, SLOT_NAMES } from "../public/overlay-utils.js";

export function forgeContract(root) {
  const agents = fs.readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const rules = agents.match(/^## Plugin authoring rules\r?\n[\s\S]*?(?=^## |$(?![\s\S]))/m)?.[0];
  if (!rules) throw new Error("AGENTS.md is missing Plugin authoring rules");
  return {
    contract: fs.readFileSync(path.join(root, "plugins", "README.md"), "utf8"),
    rules: rules.trim(), events: structuredClone(EVENT_FIELDS), positions: [...SLOT_NAMES],
  };
}

export function requireLoopback(request, response, next) {
  const address = request.socket.remoteAddress ?? "";
  if (address === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)
      || /^::ffff:127(?:\.\d{1,3}){3}$/i.test(address)) return next();
  response.status(403).json({ error: "This endpoint is available from localhost only." });
}

export function createForgeTester(publish) {
  let nextAllowedAt = -Infinity;
  const timers = new Set();
  const messages = [
    "Hello, stream!", "\u0645\u0631\u062d\u0628\u0627 \u064a\u0627 \u062c\u0645\u0627\u0639\u0629!",
    "That was a great play!", "\u0644\u0639\u0628 \u0631\u0627\u0626\u0639!",
    "Which challenge is next?", "\u062c\u0627\u0647\u0632\u0648\u0646 \u0644\u0644\u062a\u062d\u062f\u064a\u061f",
    "The overlay looks good.", "\u0623\u0647\u0644\u0627 \u0628\u0627\u0644\u0645\u0634\u0627\u0647\u062f\u064a\u0646",
    "One more round!", "\u062c\u0648\u0644\u0629 \u0623\u062e\u0631\u0649!",
    "Thanks for watching.", "\u0634\u0643\u0631\u0627 \u0644\u0644\u0645\u0634\u0627\u0647\u062f\u0629!",
  ];
  function schedule(delay, event) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      publish({ ...event, ts: Date.now() });
    }, delay);
    timer.unref?.();
    timers.add(timer);
  }
  return {
    start() {
      const now = Date.now();
      if (now < nextAllowedAt) return { started: false, retryAfterSeconds: Math.ceil((nextAllowedAt - now) / 1000) };
      nextAllowedAt = now + 5000;
      messages.forEach((text, index) => schedule(index * 650, {
        type: "chat.message", user: `TEST_Viewer${index % 4 + 1}`, text: `TEST: ${text}`,
      }));
      schedule(7400, { type: "raid", user: "TEST_Raider", viewers: 42 });
      schedule(8000, { type: "vote.result", question: "TEST: Which challenge next?", winner: "Explore",
        options: [{ label: "Explore", count: 8 }, { label: "Race", count: 4 }] });
      return { started: true, durationMs: 8000 };
    },
    stop() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
