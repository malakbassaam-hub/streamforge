import WebSocket from "ws";

const WS_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const HELIX = "https://api.twitch.tv/helix";

export function createEventSub({ clientId, getValidToken, onEvent, onStatusChange = () => {},
  WebSocketImpl = WebSocket, fetchImpl = globalThis.fetch }) {
  let current = null;
  let candidate = null;
  let retryTimer;
  let stopped = false;
  let state = "connecting";

  function setState(value) {
    state = value;
    onStatusChange(value === "connected");
  }
  const valid = connection => !stopped && !connection.disposed && current === connection;

  function dispose(connection) {
    if (!connection || connection.disposed) return;
    connection.disposed = true;
    clearTimeout(connection.welcomeTimer);
    clearTimeout(connection.watchdog);
    connection.abort.abort();
    connection.ws.terminate();
  }

  function restart(error = false) {
    if (stopped) return;
    const old = current, pending = candidate;
    current = candidate = null; // Clear identity before terminate() can emit close.
    dispose(old);
    dispose(pending);
    clearTimeout(retryTimer);
    setState(error ? "error" : "reconnecting");
    retryTimer = setTimeout(() => { setState("reconnecting"); connect(WS_URL, false); }, 5000);
  }

  function delay(connection, milliseconds) {
    return new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new Error("Connection retired")); };
      const timer = setTimeout(() => { connection.abort.signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
      connection.abort.signal.addEventListener("abort", abort, { once: true });
      if (connection.abort.signal.aborted) abort();
    });
  }

  async function api(connection, path, options = {}) {
    const token = await getValidToken();
    if (!valid(connection)) throw new Error("Connection retired");
    if (!token) throw new Error("No valid token. Log in at /auth/twitch");
    const response = await fetchImpl(`${HELIX}${path}`, {
      ...options,
      signal: AbortSignal.any([connection.abort.signal, AbortSignal.timeout(10_000)]),
      headers: { Authorization: `Bearer ${token}`, "Client-Id": clientId, "Content-Type": "application/json" },
    });
    if (!valid(connection)) throw new Error("Connection retired");
    const body = await response.json().catch(() => ({}));
    if (!valid(connection)) throw new Error("Connection retired");
    if (!response.ok) throw new Error(`Helix request failed (${response.status})`);
    return body;
  }

  async function subscribe(connection, type) {
    const condition = type === "channel.chat.message"
      ? { broadcaster_user_id: connection.user.id, user_id: connection.user.id } : { to_broadcaster_user_id: connection.user.id };
    for (let attempt = 0; attempt < 5; attempt++) {
      if (!valid(connection)) throw new Error("Connection retired");
      try {
        await api(connection, "/eventsub/subscriptions", { method: "POST", body: JSON.stringify({
          type, version: "1", condition, transport: { method: "websocket", session_id: connection.sessionId },
        }) });
        return;
      } catch (error) {
        if (!valid(connection) || attempt === 4) throw error;
        await delay(connection, Math.min(1000 * 2 ** attempt, 30_000));
      }
    }
  }

  function watch(connection) {
    clearTimeout(connection.watchdog);
    connection.watchdog = setTimeout(() => { if (valid(connection)) restart(true); }, connection.keepaliveMs);
  }

  async function message(connection, raw) {
    if (connection.disposed || stopped) return;
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch { return; }
    const type = packet.metadata?.message_type;
    if (type === "session_welcome") {
      if (candidate !== connection) return;
      const session = packet.payload?.session;
      if (!session?.id) { restart(true); return; }
      clearTimeout(connection.welcomeTimer);
      const old = current;
      connection.sessionId = session.id;
      connection.keepaliveMs = session.keepalive_timeout_seconds
        ? (session.keepalive_timeout_seconds + 10) * 1000 : old?.keepaliveMs ?? 40_000;
      // Transfer only from a fully established session that is still alive.
      const transferred = connection.transfer && old?.ready;
      current = connection;
      candidate = null;
      dispose(old);
      watch(connection);
      if (!transferred) {
        connection.user = (await api(connection, "/users")).data?.[0];
        if (!connection.user?.id) throw new Error("Twitch user lookup failed");
        // Parallel subscriptions avoid one failed type delaying the other.
        await Promise.all([subscribe(connection, "channel.chat.message"), subscribe(connection, "channel.raid")]);
      }
      if (valid(connection)) { connection.ready = true; setState("connected"); }
      return;
    }
    if (!valid(connection)) return; // Ignore late events from a retired/candidate socket.
    watch(connection);
    if (type === "session_reconnect") {
      const url = packet.payload?.session?.reconnect_url;
      if (typeof url !== "string" || !url.startsWith("wss://")) { restart(true); return; }
      if (!candidate) { setState("reconnecting"); connect(url, true); }
    } else if (type === "revocation") {
      // A new session recreates both subscriptions, including a revoked one.
      restart(true);
    } else if (type === "notification") {
      const event = packet.payload?.event;
      if (!event) return;
      const subscription = packet.metadata.subscription_type;
      if (subscription === "channel.chat.message") onEvent({ type: "chat.message", user: event.chatter_user_name, text: event.message?.text ?? "", ts: Date.now() });
      else if (subscription === "channel.raid") onEvent({ type: "raid", user: event.from_broadcaster_user_name, viewers: event.viewers, ts: Date.now() });
    }
  }

  function connect(url, transfer) {
    if (stopped) return;
    let ws;
    try { ws = new WebSocketImpl(url); } catch { restart(true); return; }
    const connection = { ws, transfer, abort: new AbortController(), ready: false, disposed: false };
    candidate = connection;
    connection.welcomeTimer = setTimeout(() => {
      if (candidate === connection && !connection.disposed) restart(true);
    }, 10_000);
    ws.on("message", raw => {
      message(connection, raw).catch(() => {
        if (valid(connection) || candidate === connection) restart(true);
      });
    });
    ws.on("close", () => {
      if (!connection.disposed && (current === connection || candidate === connection)) restart();
    });
    ws.on("error", () => {
      if (!connection.disposed && (current === connection || candidate === connection)) restart(true);
    });
  }

  connect(WS_URL, false);
  return {
    getState: () => state,
    stop() {
      stopped = true;
      clearTimeout(retryTimer);
      dispose(current); dispose(candidate);
      current = candidate = null;
      setState("error");
    },
  };
}
