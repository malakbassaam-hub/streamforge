import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export function saveTokensAtomically(file, tokens, fsImpl = fs) {
  fsImpl.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${crypto.randomUUID()}.tmp`;
  try {
    fsImpl.writeFileSync(temporary, JSON.stringify(tokens, null, 2), { mode: 0o600, flag: "wx" });
    fsImpl.renameSync(temporary, file);
  } finally {
    try { fsImpl.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

export function createTokenManager({ initialTokens, saveTokens, clientId, clientSecret, fetchImpl = globalThis.fetch }) {
  let tokens = initialTokens;
  let inFlight;
  function store(data) {
    if (!data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error("Invalid token response");
    const next = { accessToken: data.access_token, refreshToken: data.refresh_token ?? tokens?.refreshToken,
      scope: data.scope ?? tokens?.scope, expiresAt: Date.now() + data.expires_in * 1000 };
    saveTokens(next);
    tokens = next;
  }
  function getValidToken() {
    if (!tokens) return Promise.resolve(null);
    if (Date.now() < tokens.expiresAt - 60_000) return Promise.resolve(tokens.accessToken);
    if (inFlight) return inFlight;
    const source = tokens;
    inFlight = (async () => {
      try {
        const response = await fetchImpl("https://id.twitch.tv/oauth2/token", {
          method: "POST", signal: AbortSignal.timeout(10_000),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret,
            grant_type: "refresh_token", refresh_token: source.refreshToken }),
        });
        const data = await response.json();
        if (tokens !== source) return tokens?.accessToken ?? null;
        if (!response.ok || !data.access_token) {
          if (response.status === 400 || response.status === 401) { saveTokens(null); tokens = null; }
          return null;
        }
        store(data);
        return tokens.accessToken;
      } catch {
        // Keep the saved refresh token on transient network or storage failure.
        return tokens !== source ? tokens?.accessToken ?? null : null;
      }
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  }
  return { getValidToken, store, getTokens: () => tokens };
}

export function createOAuthStates() {
  const states = new Map();
  return {
    add(state) {
      const expiresAt = Date.now() + 600_000;
      const timer = setTimeout(() => { states.delete(state); }, 600_000);
      timer.unref?.();
      states.set(state, { expiresAt, timer });
    },
    delete(state) {
      const entry = states.get(state);
      if (!entry) return false;
      clearTimeout(entry.timer);
      states.delete(state);
      return Date.now() < entry.expiresAt;
    },
    close() { for (const entry of states.values()) clearTimeout(entry.timer); states.clear(); },
  };
}
