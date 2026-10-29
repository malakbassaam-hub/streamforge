import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL(".", import.meta.url));

for (const demo of ["0", "1"]) test(`actual server routes, vote limits, snapshots and recap demo mode ${demo}`, async context => {
  // Isolate token storage and dotenv configuration from the developer's server.
  const directory = fs.mkdtempSync(path.join(root, "server-test-"));

  for (const name of ["server.js", "package.json", "AGENTS.md", "config", "core", "public", "plugins"]) {
    fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
  }
  // Block the first known Forge chat in this isolated server, not in the user's config.
  fs.appendFileSync(path.join(directory, "config/blocklist.txt"), "\nhello stream\n", "utf8");
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: directory,
    env: { ...process.env, HOST: "", PORT: String(port), DEMO: demo, DOTENV_CONFIG_PATH: path.join(directory, ".env") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => {
    if (child.exitCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    fs.rmSync(directory, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Server startup timed out")), 10_000);
    child.once("error", error => { clearTimeout(timeout); reject(error); });
    child.once("exit", code => { clearTimeout(timeout); reject(new Error(`Server exited: ${code}`)); });
    child.stdout.on("data", data => {
      if (data.toString().includes(`http://127.0.0.1:${port}`)) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  const request = (route, { host = "localhost", body } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ hostname: "127.0.0.1", port, path: route,
      method: body ? "POST" : "GET", headers: { Host: host, "Content-Type": "application/json" } }, res => {
      if (route === "/events") {
        const status = res.statusCode;
        res.destroy();
        resolve({ status, headers: res.headers });
        return;
      }
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject);
    req.end(body && JSON.stringify(body));
  });
  for (const route of ["/overlay", "/control", "/events", "/api/memory", "/api/plugins"]) {
    assert.equal((await request(route)).status, 200);
    assert.equal((await request(route, { host: "evil.test" })).status, 403);
  }
  const plugin = await request("/plugins/hello/plugin.html");
  const control = await request("/control");
  assert.match(control.headers["content-type"], /charset=utf-8/i);
  assert.ok(control.text.includes("Forge Kit - Plugins"));
  assert.ok(control.text.includes("Demo hype burst"));
  const authStatus = JSON.parse((await request("/auth/status")).text);
  assert.equal(authStatus.connected, false);
  assert.equal(authStatus.eventsubState, "error");
  const authStart = await request("/auth/twitch");
  assert.equal(authStart.status, 302);
  assert.equal(new URL(authStart.headers.location).searchParams.get("scope"), "user:read:chat");
  assert.equal(plugin.status, 200);
  assert.equal(plugin.headers["content-security-policy"],
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");
  const valid = { question: "q".repeat(120), options: ["a".repeat(40), "b"], durationSeconds: 10 };
  for (const body of [
    { ...valid, question: "q".repeat(121) },
    { ...valid, options: ["a".repeat(41), "b"] },
    { ...valid, options: ["a"] },
    { ...valid, options: ["a", "b", "c", "d", "e"] },
    { ...valid, durationSeconds: 9 },
    { ...valid, durationSeconds: 301 },
  ]) assert.equal((await request("/api/vote/start", { body })).status, 400);
  assert.equal((await request("/api/vote/start", { body: valid })).status, 201);
  assert.equal((await request("/api/vote/start", { body: { ...valid, durationSeconds: 300 } })).status, 201);
  const snapshot = await new Promise((resolve, reject) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/events", headers: { Host: "localhost" } }, res => {
      let buffer = "";
      res.on("data", chunk => {
        buffer += chunk;
        if (!buffer.includes("\n\n")) return;
        res.destroy();
        resolve(JSON.parse(buffer.split("\n\n")[0].slice(6)));
      });
    });
    req.on("error", reject);
    req.setTimeout(3000, () => req.destroy(new Error("Snapshot timed out")));
  });
  assert.equal(snapshot.type, "snapshot");
  assert.equal(snapshot.vote.type, "vote.update");
  assert.equal(snapshot.vote.question, valid.question);
  assert.deepEqual(snapshot.vote.options, valid.options.map(label => ({ label, count: 0 })));
  assert.deepEqual(snapshot.chat, []);
  assert.deepEqual(snapshot.status, { live: false, demo: demo === "1" });
  const recap = await request("/api/demo/recap", { body: {} });
  assert.equal(recap.status, demo === "1" ? 201 : 404);
  const chatRecap = await request("/api/demo/chat", { body: { text: " !RECAP " } });
  assert.equal(chatRecap.status, demo === "1" ? 429 : 404);
  if (demo === "1") {
    assert.equal(chatRecap.headers["retry-after"], "60");
    const memory = JSON.parse((await request("/api/memory")).text).events;
    assert.equal(memory.filter(event => event.type === "recap.card").length, 1);
    assert.ok(memory.some(event => event.type === "vote.result" && event.question === valid.question));
    assert.ok(!memory.some(event => event.type === "chat.message" && event.text.toLowerCase().includes("!recap")));
  }
  assert.equal((await request("/plugins/recap/plugin.html")).status, 200);
  assert.equal((await request("/api/demo/burst", { host: "evil.test", body: {} })).status, 403);
  const burst = await request("/api/demo/burst", { body: {} });
  assert.equal(burst.status, demo === "1" ? 201 : 404);
  if (demo === "1") {
    assert.deepEqual(JSON.parse(burst.text), { started: true, durationMs: 5000 });
    const cooldown = await request("/api/demo/burst", { body: {} });
    assert.equal(cooldown.status, 429);
    assert.ok(Number(cooldown.headers["retry-after"]) > 0);
    const events = JSON.parse((await request("/api/memory")).text).events;
    assert.equal(events.filter(event => event.type === "raid" && event.user === "Demo_Raider" && event.viewers === 42).length, 1);
  }
  const contract = JSON.parse((await request("/api/forge/contract")).text);
  assert.deepEqual(Object.keys(contract).sort(), ["contract", "events", "positions", "rules"]);
  assert.equal(contract.contract, fs.readFileSync(path.join(directory, "plugins/README.md"), "utf8"));
  assert.match(contract.rules, /^## Plugin authoring rules/);
  assert.deepEqual(contract.events["chat.message"], ["type", "user", "text", "ts"]);
  assert.deepEqual(contract.positions, ["top-left", "top-right", "bottom-right", "recap"]);
  const status = JSON.parse((await request("/api/plugins/status")).text);
  assert.ok(status.valid.every(plugin => Array.isArray(plugin.warnings)));
  assert.deepEqual(status.invalid, []);
  const safety = JSON.parse((await request("/api/safety/stats")).text);
  assert.equal(typeof safety.blocked, "number");
  assert.equal(typeof safety.linksRemoved, "number");
  assert.equal(typeof safety.byReason, "object");
  for (const route of ["/api/forge/contract", "/api/plugins/status", "/api/safety/stats"]) {
    assert.equal((await request(route, { host: "evil.test" })).status, 403);
  }
  assert.equal((await request("/api/forge/test", { host: "evil.test", body: {} })).status, 403);
  let stream;
  let wire = "";
  const streamRequest = http.get({ hostname: "127.0.0.1", port, path: "/events", headers: { Host: "localhost" } });
  streamRequest.on("response", response => {
    stream = response;
    response.on("data", chunk => { wire += chunk; });
  });
  context.after(() => { stream?.destroy(); streamRequest.destroy(); });
  await once(streamRequest, "response");
  assert.equal((await request("/api/forge/test", { body: {} })).status, 202);
  const limited = await request("/api/forge/test", { body: {} });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  await new Promise(resolve => setTimeout(resolve, 750));
  const testMemory = JSON.parse((await request("/api/memory")).text).events;
  assert.ok(testMemory.some(event => event.type === "chat.message" && event.user.startsWith("TEST_")));
  assert.doesNotMatch(JSON.stringify(testMemory), /Hello, stream!/);
  assert.doesNotMatch(wire, /Hello, stream!/);
  assert.match(wire, /TEST_Viewer2/);
  const afterFilter = JSON.parse((await request("/api/safety/stats")).text);
  assert.ok(afterFilter.blocked >= 1);
  assert.ok(afterFilter.byReason.blocklist >= 1);
  stream.destroy();
  streamRequest.destroy();

});
