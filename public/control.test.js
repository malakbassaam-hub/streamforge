import assert from "node:assert/strict";
import test from "node:test";
import { parseDurationSeconds } from "./control.js";

test("duration parser accepts Arabic-Indic digits and enforces 10 through 300", () => {
  assert.equal(parseDurationSeconds(" ١٠ "), 10);
  assert.equal(parseDurationSeconds("٣٠٠"), 300);
  assert.throws(() => parseDurationSeconds("٩"), RangeError);
  assert.throws(() => parseDurationSeconds("٣٠١"), RangeError);
  assert.throws(() => parseDurationSeconds("10.5"), RangeError);
  assert.throws(() => parseDurationSeconds(""), RangeError);
});
