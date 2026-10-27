import assert from "node:assert/strict";
import test from "node:test";
import { buildRecap, createRecapManager, isRecapCommand } from "./recap.js";
import { createEventHandler } from "./events.js";

test("recap summarizes the last ten minutes, including ties and the busiest UTC minute", () => {
  const now = Date.UTC(2026, 0, 1, 12, 10);
  const history = [
    { type: "chat.message", user: "Old", ts: now - 600_001 },
    { type: "chat.message", user: "Future", ts: now + 1 },
    { type: "chat.message", user: "Alice", ts: now - 120_000 },
    { type: "chat.message", user: "ALICE", ts: now - 119_000 },
    { type: "chat.message", user: "Bob", ts: now - 60_000 },
    { type: "raid", user: "OldRaid", viewers: 2, ts: now - 80_000 },
    { type: "raid", user: "Raider", viewers: 42, ts: now - 50_000 },
    { type: "vote.result", question: "Old?", winner: "Old", storedAt: now - 40_000 },
    { type: "vote.result", question: "Next game?", winner: ["A", "B"], storedAt: now - 30_000 },
  ];
  assert.deepEqual(buildRecap(history, now), [
    "Recap: last 10 minutes", "Chat: 3 messages from 2 unique chatters",
    "Most active: Alice (2 messages)", "Latest raid: Raider (42 viewers)",
    "Last vote: Next game? - A / B", "Chat peak: 12:08 UTC (2 messages/min)",
  ]);
  history.push({ type: "vote.result", question: "Again?", winner: null, ts: now });
  assert.ok(buildRecap(history, now).includes("Last vote: Again? - no votes"));
});

test("empty or irrelevant history says Nothing happened yet", () => {
  assert.deepEqual(buildRecap([], 1000), ["Recap: last 10 minutes", "Nothing happened yet"]);
  assert.ok(buildRecap([{ type: "status", ts: 1000 }, { type: "chat.message", text: "!RECAP", ts: 1000 }], 1000).includes("Nothing happened yet"));
});

test("recap sanitizes usernames, raid names, and vote labels", () => {
  const lines = buildRecap([
    { type: "chat.message", user: " <b>Alice</b>\n\u202e", ts: 1000 },
    { type: "raid", user: "<img src=x>Raider\u0000", viewers: 3, ts: 1000 },
    { type: "vote.result", question: "<b>Pick</b>", winner: "<i>A</i>", ts: 1000 },
  ], 1000);
  assert.ok(lines.includes("Most active: Alice (1 messages)"));
  assert.ok(lines.includes("Latest raid: Raider (3 viewers)"));
  assert.ok(lines.includes("Last vote: Pick - A"));
  assert.equal(/[<>\n\u202e\u0000]/.test(lines.join("")), false);
});

test("recap command has a global sixty-second cooldown and never enters the chat history", context => {
  context.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const published = [];
  const manager = createRecapManager(() => [], event => published.push(event));
  const handler = createEventHandler({ handleChatMessage() { assert.fail("Recap must not be processed as a vote"); } },
    () => assert.fail("Recap command must not be published as chat"), () => manager.request());
  handler({ type: "chat.message", user: "A", text: "  !ReCaP  " });
  handler({ type: "chat.message", user: "B", text: "!recap" });
  assert.equal(published.length, 1);
  assert.equal(published[0].type, "recap.card");
  assert.equal(published[0].ts, 1000);
  assert.deepEqual(manager.request(), { published: false, retryAfterSeconds: 60 });
  context.mock.timers.tick(59_999);
  assert.equal(manager.request().published, false);
  context.mock.timers.tick(1);
  assert.equal(manager.request().published, true);
  assert.equal(published.length, 2);
  assert.equal(isRecapCommand("!recap please"), false);
});
