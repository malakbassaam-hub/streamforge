import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createEventSub } from "./eventsub.js";

const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

function setup(context, subscription = () => response({})) {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const sockets = [], requests = [], events = [], status = [];
  class FakeWebSocket extends EventEmitter {
    constructor(url) { super(); this.url = url; this.readyState = 1; sockets.push(this); }
    terminate() { this.readyState = 3; this.emit("close", 1006); }
    packet(type, payload = {}, metadata = {}) {
      this.emit("message", JSON.stringify({ metadata: { message_type: type, ...metadata }, payload }));
    }
    welcome(id = "session") { this.packet("session_welcome", { session: { id, keepalive_timeout_seconds: 30 } }); }
  }
  const client = createEventSub({ clientId: "client", getValidToken: async () => "token",
    onEvent: event => events.push(event), onStatusChange: live => status.push(live), WebSocketImpl: FakeWebSocket,
    fetchImpl: async (url, options) => {
      if (url.endsWith("/users")) return response({ data: [{ id: "1", login: "viewer" }] });
      const body = JSON.parse(options.body);
      requests.push({ ...body, at: Date.now() });
      return subscription(body);
    },
  });
  context.after(() => client.stop());
  return { client, sockets, requests, events, status };
}

test("subscriptions retry with exponential delays and report connected only after both succeed", async context => {
  let attempts = 0;
  const { client, sockets, requests } = setup(context, body => {
    if (body.type === "channel.chat.message" && ++attempts < 3) return response({}, 503);
    return response({});
  });
  assert.equal(client.getState(), "connecting");
  sockets[0].welcome(); await flush();
  assert.equal(client.getState(), "connecting");
  context.mock.timers.tick(999); await flush();
  assert.equal(attempts, 1);
  context.mock.timers.tick(1); await flush();
  assert.equal(attempts, 2);
  context.mock.timers.tick(2000); await flush();
  assert.equal(client.getState(), "connected");
  assert.deepEqual(requests.filter(request => request.type === "channel.chat.message").map(request => request.at), [1000, 2000, 4000]);
});

test("subscription conflicts retry at most five times rather than claiming a connected session", async context => {
  const { client, sockets, requests } = setup(context, () => response({}, 409));
  sockets[0].welcome(); await flush();
  for (const delay of [1000, 2000, 4000, 8000]) { context.mock.timers.tick(delay); await flush(); }
  assert.equal(requests.filter(request => request.type === "channel.chat.message").length, 5);
  assert.equal(client.getState(), "error");
  assert.equal(sockets[0].readyState, 3);
});

test("initial welcome timeout retires the socket and ignores a late welcome", async context => {
  const { client, sockets, requests } = setup(context);
  context.mock.timers.tick(10_000); await flush();
  assert.equal(client.getState(), "error");
  assert.equal(sockets[0].readyState, 3);
  sockets[0].welcome("late"); await flush();
  assert.equal(requests.length, 0);
  context.mock.timers.tick(5000); await flush();
  assert.equal(sockets.length, 2);
  sockets[1].welcome("fresh"); await flush();
  assert.equal(client.getState(), "connected");
});

test("revocation reconnects and recreates subscriptions for a fresh session", async context => {
  const { client, sockets, requests } = setup(context);
  sockets[0].welcome("first"); await flush();
  sockets[0].packet("revocation", { subscription: { type: "channel.chat.message", status: "authorization_revoked" } });
  assert.equal(client.getState(), "error");
  context.mock.timers.tick(5000); await flush();
  sockets[1].welcome("second"); await flush();
  assert.equal(client.getState(), "connected");
  assert.deepEqual(requests.map(request => request.transport.session_id), ["first", "first", "second", "second"]);
});

test("failed reconnect handoff cannot leave a stale current socket or accept its notifications", async context => {
  const { client, sockets, events, requests } = setup(context);
  sockets[0].welcome("first"); await flush();
  sockets[0].packet("session_reconnect", { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" } });
  assert.equal(client.getState(), "reconnecting");
  sockets[1].emit("error", new Error("Handoff failed"));
  assert.equal(sockets[0].readyState, 3);
  assert.equal(sockets[1].readyState, 3);
  sockets[0].packet("notification", { event: { chatter_user_name: "Stale", message: { text: "late" } } }, { subscription_type: "channel.chat.message" });
  sockets[1].welcome("late"); await flush();
  assert.equal(events.length, 0);
  context.mock.timers.tick(5000); await flush();
  sockets[2].welcome("fresh"); await flush();
  assert.equal(client.getState(), "connected");
  assert.equal(requests.filter(request => request.transport.session_id === "fresh").length, 2);
});

test("successful reconnect transfers subscriptions and ignores old socket closes", async context => {
  const { client, sockets, requests } = setup(context);
  sockets[0].welcome("first"); await flush();
  sockets[0].packet("session_reconnect", { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" } });
  sockets[1].welcome("transferred"); await flush();
  assert.equal(client.getState(), "connected");
  assert.equal(requests.length, 2);
  sockets[0].emit("close", 1000);
  assert.equal(client.getState(), "connected");
});

test("handoff welcome timeout closes both sockets and a missing keepalive triggers recovery", async context => {
  const { client, sockets } = setup(context);
  sockets[0].welcome("first"); await flush();
  sockets[0].packet("session_reconnect", { session: { reconnect_url: "wss://eventsub.wss.twitch.tv/reconnect" } });
  context.mock.timers.tick(10_000); await flush();
  assert.equal(client.getState(), "error");
  assert.equal(sockets[0].readyState, 3);
  assert.equal(sockets[1].readyState, 3);
  context.mock.timers.tick(5000); await flush();
  sockets[2].welcome("fresh"); await flush();
  context.mock.timers.tick(40_000); await flush();
  assert.equal(client.getState(), "error");
  assert.equal(sockets[2].readyState, 3);
});

test("closing a session cancels pending subscription retries", async context => {
  const { sockets, requests } = setup(context, () => response({}, 503));
  sockets[0].welcome(); await flush();
  assert.equal(requests.length, 2);
  sockets[0].terminate();
  await flush();
  context.mock.timers.tick(4000); await flush();
  assert.equal(requests.length, 2);
});
