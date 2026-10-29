import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTokenManager, saveTokensAtomically, createOAuthStates } from "./auth.js";

test("concurrent refreshes share one fetch and one persisted token response", async () => {
  let release, calls = 0;
  const saved = [];
  const manager = createTokenManager({ initialTokens: { accessToken: "expired", refreshToken: "refresh", expiresAt: 0 },
    saveTokens: tokens => saved.push(tokens), clientId: "client", clientSecret: "secret",
    fetchImpl: () => { calls++; return new Promise(resolve => { release = resolve; }); },
  });
  const a = manager.getValidToken(), b = manager.getValidToken(), c = manager.getValidToken();
  assert.equal(a, b); assert.equal(b, c); assert.equal(calls, 1);
  release({ ok: true, json: async () => ({ access_token: "new", refresh_token: "rotated", expires_in: 3600 }) });
  assert.deepEqual(await Promise.all([a, b, c]), ["new", "new", "new"]);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].refreshToken, "rotated");
});

test("transient refresh failure permits a later retry and does not discard saved credentials", async () => {
  let calls = 0;
  const manager = createTokenManager({ initialTokens: { accessToken: "expired", refreshToken: "refresh", expiresAt: 0 }, saveTokens() {},
    fetchImpl: async () => ++calls === 1 ? { ok: false, status: 503, json: async () => ({}) }
      : { ok: true, json: async () => ({ access_token: "new", expires_in: 3600 }) },
  });
  assert.equal(await manager.getValidToken(), null);
  assert.equal(manager.getTokens().refreshToken, "refresh");
  assert.equal(await manager.getValidToken(), "new");
});

test("a slow refresh cannot overwrite a more recent OAuth login", async () => {
  let release;
  const manager = createTokenManager({ initialTokens: { refreshToken: "old", expiresAt: 0 }, saveTokens() {},
    fetchImpl: () => new Promise(resolve => { release = resolve; }),
  });
  const refresh = manager.getValidToken();
  manager.store({ access_token: "login", refresh_token: "login-refresh", expires_in: 3600 });
  release({ ok: true, json: async () => ({ access_token: "stale", expires_in: 3600 }) });
  assert.equal(await refresh, "login");
  assert.equal(manager.getTokens().refreshToken, "login-refresh");
});

test("token saving writes a temporary file then renames it, preserving old tokens on failure", context => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "streamforge-tokens-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "tokens.json");
  saveTokensAtomically(file, { accessToken: "old" });
  const operations = [];
  saveTokensAtomically(file, { accessToken: "new" }, { ...fs,
    writeFileSync(...args) { operations.push("write"); assert.notEqual(args[0], file); return fs.writeFileSync(...args); },
    renameSync(...args) { operations.push("rename"); return fs.renameSync(...args); },
  });
  assert.deepEqual(operations, ["write", "rename"]);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).accessToken, "new");
  assert.throws(() => saveTokensAtomically(file, { accessToken: "failed" }, { ...fs, renameSync() { throw new Error("Disk failure"); } }));
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).accessToken, "new");
  assert.deepEqual(fs.readdirSync(root), ["tokens.json"]);
});

test("OAuth states are one-time and expire after ten minutes", context => {
  context.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const states = createOAuthStates();
  context.after(() => states.close());
  states.add("used");
  assert.equal(states.delete("used"), true);
  assert.equal(states.delete("used"), false);
  states.add("expired");
  context.mock.timers.tick(600_000);
  assert.equal(states.delete("expired"), false);
});
