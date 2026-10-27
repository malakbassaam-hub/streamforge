import assert from "node:assert/strict";
import test from "node:test";
import { createSnapshotStore } from "./snapshot.js";
import { createVoteManager } from "./vote.js";

test("snapshot retains an open vote and the last five chats independently of event memory", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const store = createSnapshotStore();
  const manager = createVoteManager(event => store.record(event));
  assert.deepEqual(store.getSnapshot(), { type: "snapshot", vote: null, chat: [], status: { live: false, demo: false } });
  manager.start("Pick", ["A", "B"], 10);
  manager.handleChatMessage("Viewer", "!2");
  for (let i = 0; i < 7; i++) store.record({ type: "chat.message", user: "Viewer", text: String(i), ts: i });
  for (let i = 0; i < 110; i++) store.record({ type: "raid", user: "Raider", viewers: 5, ts: i });
  const snapshot = store.getSnapshot();
  assert.equal(snapshot.vote.question, "Pick");
  assert.equal(snapshot.vote.endsAt, 11_000);
  assert.equal(snapshot.vote.startedAt, 1000);
  assert.deepEqual(snapshot.vote.options, [{ label: "A", count: 0 }, { label: "B", count: 1 }]);
  assert.deepEqual(snapshot.chat.map(event => event.text), ["2", "3", "4", "5", "6"]);
  snapshot.vote.options[0].count = 999;
  snapshot.chat.length = 0;
  assert.equal(store.getSnapshot().vote.options[0].count, 0);
  assert.equal(store.getSnapshot().chat.length, 5);
});

test("snapshot restores just-ended results for the remaining eight-second display window", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const store = createSnapshotStore();
  const manager = createVoteManager(event => store.record(event));
  manager.start("Pick", ["A", "B"], 10);
  manager.handleChatMessage("Viewer", "!1");
  context.mock.timers.tick(10_000);
  const result = store.getSnapshot().vote;
  assert.equal(result.type, "vote.result");
  assert.equal(result.question, "Pick");
  assert.equal(result.winner, "A");
  assert.equal(result.hideAt, 19_000);
  context.mock.timers.tick(7999);
  assert.equal(store.getSnapshot().vote.hideAt, 19_000);
  context.mock.timers.tick(1);
  assert.equal(store.getSnapshot().vote, null);
  manager.start("Next", ["C", "D"], 10);
  assert.equal(store.getSnapshot().vote.type, "vote.update");
  assert.equal(store.getSnapshot().vote.hideAt, undefined);
});

test("snapshot status follows simulator and Twitch independently", () => {
  const store = createSnapshotStore();
  store.setStatus({ demo: true });
  assert.deepEqual(store.getSnapshot().status, { live: false, demo: true });
  store.setStatus({ live: true });
  assert.deepEqual(store.getSnapshot().status, { live: true, demo: true });
  store.setStatus({ live: false });
  assert.deepEqual(store.getSnapshot().status, { live: false, demo: true });
});
