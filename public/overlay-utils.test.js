import assert from "node:assert/strict";
import test from "node:test";
import { SLOT_NAMES, layoutSlots, clampToSlot, commandText, recapLines } from "./overlay-utils.js";

function overlaps(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

test("named slots clamp plugin dimensions and reserve a separate vote zone at both resolutions", () => {
  assert.deepEqual(SLOT_NAMES, ["top-left", "top-right", "bottom-right", "recap"]);
  for (const [width, height] of [[1920, 1080], [1280, 720]]) {
    const slots = layoutSlots(width, height);
    assert.ok(slots.vote.width <= 560);
    for (let i = 0; i < SLOT_NAMES.length; i++) {
      for (const other of SLOT_NAMES.slice(i + 1)) {
        assert.equal(overlaps(slots[SLOT_NAMES[i]], slots[other]), false, `${SLOT_NAMES[i]} overlaps ${other}`);
      }
    }
    for (const name of SLOT_NAMES) {
      const rect = clampToSlot({ position: name, width: 2000, height: 2000 }, slots);
      assert.deepEqual(rect, slots[name]);
      assert.equal(overlaps(rect, slots.vote), false, `${name} overlaps vote at ${width}`);
      assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width && rect.y + rect.height <= height);
    }
    assert.equal(clampToSlot({ position: "bottom-left", width: 100, height: 100 }, slots), null);
    const small = clampToSlot({ position: "recap", width: 100, height: 80 }, slots);
    assert.equal(small.width, 100);
    assert.equal(small.height, 80);
  }
});

test("pure command classification accepts both digit sets without swallowing ordinary chat", () => {
  for (const text of ["!1", " !4 ", "!\u0661", "!\u0664", " !ReCaP "]) {
    assert.equal(commandText({ type: "chat.message", text }), text.trim());
  }
  for (const text of ["!1 yes", "!recap please", "!5", "hello !1", "hello"]) {
    assert.equal(commandText({ type: "chat.message", text }), null);
  }
  assert.equal(commandText({ type: "raid", text: "!1" }), null);
});

test("recap presentation drops empty lines and renders relative peak times across midnight", () => {
  assert.deepEqual(recapLines(["Recap: last 10 minutes", "Chat: 3 messages from 2 unique chatters", "Latest raid: none", "Last vote: none", "Chat peak: 23:59 UTC (3 messages/min)"], Date.UTC(2026, 9, 28, 0, 2)),
    ["Chat: 3 messages from 2 unique chatters", "Chat peak: 3 min ago (3 messages/min)"]);
  assert.deepEqual(recapLines(["Recap: last 10 minutes", "Nothing happened yet"], Date.now()), ["Nothing happened yet"]);
});
