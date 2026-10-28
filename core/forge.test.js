import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { forgeContract, createForgeTester, requireLoopback } from "./forge.js";
import { EVENT_FIELDS, SLOT_NAMES, forwardedEvent } from "../public/overlay-utils.js";

test("Forge contract uses actual docs and the overlay's field and position allowlists", () => {
  const contract = forgeContract(fileURLToPath(new URL("..", import.meta.url)));
  assert.equal(contract.contract, fs.readFileSync(new URL("../plugins/README.md", import.meta.url), "utf8"));
  assert.deepEqual(contract.events, EVENT_FIELDS);
  assert.deepEqual(contract.positions, SLOT_NAMES);
  assert.match(contract.rules, /^## Plugin authoring rules/);
  assert.match(contract.rules, /No network requests/);
  assert.match(contract.rules, /approximately 30/);
  assert.doesNotMatch(contract.rules, /## Architecture/);
  for (const [type, fields] of Object.entries(EVENT_FIELDS)) {
    const forwarded = forwardedEvent({ type, options: [], lines: [], ts: Date.now(), secret: "hidden" });
    assert.deepEqual(Object.keys(forwarded), fields);
    assert.equal("secret" in forwarded, false);
  }
});

test("Forge sequence publishes 12 mixed-language chats, a raid and a vote result over eight seconds", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const events = [];
  const tester = createForgeTester(event => events.push(event));
  assert.deepEqual(tester.start(), { started: true, durationMs: 8000 });
  assert.deepEqual(tester.start(), { started: false, retryAfterSeconds: 5 });
  context.mock.timers.tick(8000);
  const chats = events.filter(event => event.type === "chat.message");
  assert.equal(chats.length, 12);
  assert.ok(chats.some(event => /[\u0600-\u06ff]/.test(event.text)));
  assert.ok(chats.some(event => event.text.includes("Hello")));
  assert.ok(chats.every(event => event.user.startsWith("TEST_") && event.text.startsWith("TEST:")));
  assert.equal(events.filter(event => event.type === "raid").length, 1);
  assert.equal(events.filter(event => event.type === "vote.result").length, 1);
  assert.match(events.at(-1).question, /^TEST:/);
  assert.ok(events.every(event => Number.isFinite(event.ts)));
});

test("Forge rate limit expires at five seconds and stop cancels pending events", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const events = [];
  const tester = createForgeTester(event => events.push(event));
  tester.start();
  context.mock.timers.tick(4999);
  assert.equal(tester.start().started, false);
  context.mock.timers.tick(1);
  assert.equal(tester.start().started, true);
  tester.stop();
  const count = events.length;
  context.mock.timers.tick(10_000);
  assert.equal(events.length, count);
});

test("Forge guard checks socket loopback rather than forwarded headers", () => {
  for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "192.168.1.20", "203.0.113.1", undefined]) {
    let allowed = false;
    let status;
    requireLoopback({ socket: { remoteAddress: address }, headers: { host: "localhost", "x-forwarded-for": "127.0.0.1" } },
      { status(value) { status = value; return this; }, json() {} }, () => { allowed = true; });
    assert.equal(allowed, ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address));
    if (!allowed) assert.equal(status, 403);
  }
});
