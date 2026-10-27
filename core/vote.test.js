import assert from "node:assert/strict";
import test from "node:test";
import { createVoteManager, VoteInputError } from "./vote.js";

test("votes can be changed once per user and invalid options are ignored", (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const events = [];
  const manager = createVoteManager((event) => events.push(event));

  manager.start("Pick one", ["First", "Second", "Third"], 10);
  assert.equal(manager.handleChatMessage("Viewer", "!4"), false);
  assert.equal(manager.handleChatMessage("Viewer", "hello !1"), false);
  assert.equal(manager.handleChatMessage("Viewer", "!1"), true);
  assert.equal(manager.handleChatMessage("viewer", "!3"), true);

  assert.deepEqual(events.at(-1).options, [
    { label: "First", count: 0 },
    { label: "Second", count: 0 },
    { label: "Third", count: 1 },
  ]);
  assert.equal(events.filter(({ type }) => type === "vote.update").length, 3);
  assert.equal(manager.isOpen(), true);
});

test("vote completion publishes the winner and final counts", (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const events = [];
  const manager = createVoteManager((event) => events.push(event));

  manager.start("Pick one", ["First", "Second"], 10);
  manager.handleChatMessage("Viewer A", "!2");
  manager.handleChatMessage("Viewer B", "!2");
  context.mock.timers.tick(10_000);

  assert.deepEqual(events.at(-1), {
    type: "vote.result",
    question: "Pick one",
    winner: "Second",
    options: [
      { label: "First", count: 0 },
      { label: "Second", count: 2 },
    ],
  });
  assert.equal(manager.isOpen(), false);
});

test("empty votes have no winner and ties publish all co-winners", (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const events = [];
  const manager = createVoteManager((event) => events.push(event));

  manager.start("Pick one", ["First", "Second"], 10);
  context.mock.timers.tick(10_000);
  assert.equal(events.at(-1).winner, null);

  manager.start("Pick one", ["First", "Second", "Third"], 10);
  manager.handleChatMessage("Viewer A", "!1");
  manager.handleChatMessage("Viewer B", "!2");
  context.mock.timers.tick(10_000);
  assert.deepEqual(events.at(-1).winner, ["First", "Second"]);
});

test("Arabic-Indic vote digits and trailing text are accepted", (context) => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const events = [];
  const manager = createVoteManager((event) => events.push(event));

  manager.start("Pick one", ["First", "Second"], 10);

  assert.equal(manager.handleChatMessage("Viewer A", "  !١ yes  "), true);
  assert.equal(manager.handleChatMessage("Viewer B", "!2 YES"), true);
  assert.equal(events.at(-1).options[0].count, 1);
  assert.equal(events.at(-1).options[1].count, 1);
});

test("invalid vote setup is rejected", () => {
  const manager = createVoteManager(() => {});

  assert.throws(() => manager.start("", ["First", "Second"], 10), VoteInputError);
  assert.throws(() => manager.start("Pick one", ["First"], 10), VoteInputError);
  assert.throws(() => manager.start("Pick one", ["First", "first"], 10), VoteInputError);
  assert.throws(() => manager.start("Pick one", ["First", "Second"], 0), VoteInputError);
});
