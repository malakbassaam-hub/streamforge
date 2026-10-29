import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sanitizeChat, createChatFilter, loadBlocklist } from "./safety.js";
import { createEventHandler } from "./events.js";
import { createVoteManager } from "./vote.js";
import { createSnapshotStore } from "./snapshot.js";
import { buildRecap } from "./recap.js";
import { forwardedEvent } from "../public/overlay-utils.js";

test("sanitizer strips invisible/control/bidi characters, normalizes NFKC and collapses whitespace", () => {
  const result = sanitizeChat("  Ｈｅｌｌｏ\u0000\u200b\u200c\u200d\ufeff\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069\t\n  world  ", { terms: [] });
  assert.equal(result.text, "Hello world");
  assert.equal(result.flagged, false);
  assert.ok(result.reasons.includes("invisible_characters"));
  assert.equal(sanitizeChat(null).text, "");
  assert.equal([...sanitizeChat("😀🙂".repeat(125)).text].length, 200);
});

test("URLs are replaced and long repeated-character runs collapse without blocking clean chat", () => {
  const result = sanitizeChat("Look https://example.test/a www.example.org example.com/path coooooool!", { terms: [] });
  assert.equal(result.text, "Look [link] [link] [link] cooool!");
  assert.equal(result.flagged, false);
  assert.deepEqual(result.reasons, ["links_removed", "repeated_characters"]);
  const filter = createChatFilter({ terms: [] });
  filter.sanitizeChat("https://example.com www.example.org", "Viewer");
  assert.equal(filter.getStats().linksRemoved, 2);
});

test("normalized blocklist matches separators, case, look-alikes and Arabic diacritics/tatweel", () => {
  for (const text of ["bad", "b.a.d", "B-A-D", "b а d", "b4d", "ｂａｄ", "b\u200ba\u202ed", "x".repeat(201) + " bad"]) {
    const result = sanitizeChat(text, { terms: ["bad"] });
    assert.equal(result.flagged, true, text);
    assert.equal(result.text, "");
    assert.ok(result.reasons.includes("blocklist"));
  }
  assert.equal(sanitizeChat("سَــيِّء", { terms: ["سيء"] }).flagged, true);
  assert.equal(sanitizeChat("لطيف", { terms: ["سيء"] }).flagged, false);
});

test("blocklist file ignores blank and comment lines", context => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-blocklist-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "blocklist.txt");
  fs.writeFileSync(file, "# comment\r\n\n bad \n  # another comment\nسيء\n", "utf8");
  assert.deepEqual(loadBlocklist(file), ["bad", "سيء"]);
});

test("all-caps spam is blocked but short cheers and Arabic text remain usable", () => {
  assert.equal(sanitizeChat("THIS IS A VERY LOUD MESSAGE").flagged, true);
  assert.ok(sanitizeChat("THIS IS A VERY LOUD MESSAGE").reasons.includes("caps_spam"));
  assert.equal(sanitizeChat("HYPE!").flagged, false);
  assert.equal(sanitizeChat("مرحبا بالجميع").flagged, false);
});

test("spam limits are per user, expire, and keep only aggregate statistics", context => {
  context.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const filter = createChatFilter({ terms: [] });
  assert.equal(filter.sanitizeChat("Hello there", "Viewer").flagged, false);
  assert.equal(filter.sanitizeChat("Hello there", "VIEWER").flagged, false);
  assert.ok(filter.sanitizeChat("Hello there", "viewer").reasons.includes("repeated_message"));
  assert.equal(filter.sanitizeChat("Hello there", "Other").flagged, false);
  for (let i = 0; i < 5; i++) assert.equal(filter.sanitizeChat(`Unique ${i}`, "Fast").flagged, false);
  assert.ok(filter.sanitizeChat("Another message", "Fast").reasons.includes("rate_limit"));
  assert.equal(filter.getStats().blocked, 2);
  assert.equal(JSON.stringify(filter.getStats()).includes("Hello there"), false);
  const copy = filter.getStats(); copy.blocked = 999;
  assert.equal(filter.getStats().blocked, 2);
  context.mock.timers.tick(30_000);
  assert.equal(filter.sanitizeChat("Hello there", "viewer").flagged, false);
  assert.equal(filter.sanitizeChat("Another message", "Fast").flagged, false);
});

test("blocked text never reaches votes, publication/SSE payloads, snapshots, plugins or recaps", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const memory = [], sse = [], plugins = [];
  const snapshots = createSnapshotStore();
  const publish = event => {
    memory.push({ ...event, storedAt: Date.now() });
    sse.push(`data: ${JSON.stringify(event)}\n\n`);
    snapshots.record(event);
    plugins.push(forwardedEvent(event));
  };
  const manager = createVoteManager(publish);
  manager.start("Pick", ["A", "B"], 10);
  const handle = createEventHandler(manager, publish, undefined, createChatFilter({ terms: ["forbidden"] }));
  handle({ type: "chat.message", user: "Blocked", text: "!1 f.o.r.b.i.d.d.e.n" });
  assert.equal(memory.length, 1);
  handle({ type: "chat.message", user: "A", text: "!1" });
  handle({ type: "chat.message", user: "B", text: "!٢" });
  handle({ type: "chat.message", user: "C", text: "hello https://example.com" });
  const vote = memory.filter(event => event.type === "vote.update").at(-1);
  assert.deepEqual(vote.options.map(option => option.count), [1, 1]);
  assert.equal(memory.at(-1).text, "hello [link]");
  for (const downstream of [memory, sse, plugins, snapshots.getSnapshot(), buildRecap(memory, 1000)]) {
    assert.doesNotMatch(JSON.stringify(downstream), /f\.o\.r\.b|forbidden|Blocked|example\.com/);
  }
});
