import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL(".", import.meta.url));

test("actual server binds locally, guards routes, and enforces vote API limits", async context => {
  // Isolate token storage and dotenv configuration from the developer's server.
  const directory = fs.mkdtempSync(path.join(root, "server-test-"));

  for (const name of ["server.js", "package.json", "core", "public", "plugins"]) {
    fs.cpSync(path.join(root, name), path.join(directory, name), { recursive: true });
  }
  const reservation = http.createServer();
  reservation.listen(0, "127.0.0.1");
  await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: directory,
    env: { ...process.env, HOST: "", PORT: String(port), DEMO: "0", DOTENV_CONFIG_PATH: path.join(directory, ".env") },
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
      res.resume();
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers }));
    });
    req.on("error", reject);
    req.end(body && JSON.stringify(body));
  });
  for (const route of ["/overlay", "/control", "/events", "/api/memory", "/api/plugins"]) {
    assert.equal((await request(route)).status, 200);
    assert.equal((await request(route, { host: "evil.test" })).status, 403);
  }
  const plugin = await request("/plugins/hello2/plugin.html");
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
  assert.deepEqual(snapshot.status, { live: false, demo: false });
});
