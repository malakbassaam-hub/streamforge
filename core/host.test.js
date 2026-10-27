import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import http from "node:http";
import { requireLocalHost } from "./host.js";
import { createVoteManager, VoteInputError } from "./vote.js";

test("Host guard preserves local routes and rejects foreign or missing hosts", async context => {
  const app = express();
  app.use(requireLocalHost);
  app.get(["/overlay", "/control", "/events", "/api/memory"], (_req, res) => res.send("ok"));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  context.after(() => new Promise(resolve => server.close(resolve)));
  const request = (host, route) => new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port: server.address().port, path: route,
      setHost: false, headers: host === undefined ? {} : { Host: host } }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
  });
  for (const host of ["localhost", "localhost:3000", "127.0.0.1:3000", "[::1]:3000", "LOCALHOST"]) {
    for (const route of ["/overlay", "/control", "/events", "/api/memory"]) {
      assert.equal(await request(host, route), 200);
    }
  }
  for (const host of ["evil.test", "localhost.evil.test", "127.1", "localhost@evil.test", "[::1].evil", ""]) {
    assert.equal(await request(host, "/overlay"), 403);
  }
});

test("server-side vote limits reject invalid inputs and accept boundaries", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  const manager = createVoteManager(() => {});
  for (const [question, options, duration] of [
    ["q".repeat(121), ["a", "b"], 10],
    ["q", ["a".repeat(41), "b"], 10],
    ["q", ["a"], 10],
    ["q", ["a", "b", "c", "d", "e"], 10],
    ["q", ["a", "b"], 9.99],
    ["q", ["a", "b"], 300.01],
    ["q", ["a", "b"], NaN],
    ["q", ["a", "b"], "30"],
  ]) assert.throws(() => manager.start(question, options, duration), VoteInputError);
  manager.start("q".repeat(120), ["a".repeat(40), "b"], 10);
  manager.start("q", ["a", "b", "c", "d"], 300);
  context.mock.timers.tick(300_000);
  assert.equal(manager.isOpen(), false);
});
