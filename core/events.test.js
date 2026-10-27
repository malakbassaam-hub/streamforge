import assert from "node:assert/strict";
import test from "node:test";
import { createEventHandler, normalizeEvent } from "./events.js";
import { createDemoSimulator } from "./demo.js";

test("normalization strips extra fields and sanitizes before voting and publication", () => {
  const calls = [];
  const handle = createEventHandler({ handleChatMessage: (...args) => calls.push(args) }, event => calls.push(event));
  handle({ type: "chat.message", user: "Viewer", text: `  !1 ${"x".repeat(250)}  `, ts: 123, secret: "hidden" });
  const text = `!1 ${"x".repeat(197)}`;
  assert.deepEqual(calls, [["Viewer", text], { type: "chat.message", user: "Viewer", text, ts: 123 }]);
  assert.deepEqual(normalizeEvent({ type: "raid", user: "Raider", viewers: 42, ts: 123, secret: "hidden" }),
    { type: "raid", user: "Raider", viewers: 42, ts: 123 });
  assert.equal(normalizeEvent({ type: "chat.message", text: null }).text, "");
});

test("demo chat and raids use the same numeric timestamp contract", context => {
  context.mock.timers.enable({ apis: ["Date", "setInterval"], now: 1000 });
  const received = [];
  const simulator = createDemoSimulator();
  simulator.events.on("event", createEventHandler({ handleChatMessage() {} }, event => received.push(event)));
  simulator.start();
  context.mock.timers.tick(12_000);
  simulator.stop();
  assert.equal(received.length, 4);
  assert.equal(received[0].type, "chat.message");
  assert.equal(received[3].type, "raid");
  for (const event of received) {
    assert.equal(typeof event.user, "string");
    assert.equal(typeof event.ts, "number");
    assert.equal("timestamp" in event, false);
  }
});
