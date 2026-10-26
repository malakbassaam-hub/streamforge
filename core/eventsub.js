import WebSocket from "ws";
const WS_URL = "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30";
const HELIX = "https://api.twitch.tv/helix";
let running = false;
export function startEventSub({ clientId, getValidToken, onEvent }) {
  if (running) return;
  running = true;
  let user = null;
  let current = null;
  let watchdog = null;
  let keepaliveMs = 40000;
  async function api(path, options = {}) {
    const token = await getValidToken();
    if (!token) throw new Error("No valid token. Log in at /auth/twitch");
    const res = await fetch(`${HELIX}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": clientId,
        "Content-Type": "application/json",
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`Helix ${res.status}: ${body.message || JSON.stringify(body)}`);
    return body;
  }
  async function subscribe(type, condition, sessionId) {
    try {
      await api("/eventsub/subscriptions", {
        method: "POST",
        body: JSON.stringify({
          type,
          version: "1",
          condition,
          transport: { method: "websocket", session_id: sessionId },
        }),
      });
      console.log(`[eventsub] subscribed: ${type}`);
    } catch (err) {
      console.error(`[eventsub] subscribe failed for ${type}:`, err.message);
    }
  }
  function resetWatchdog(ws) {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      console.warn("[eventsub] keepalive timeout, reconnecting");
      ws.terminate();
    }, keepaliveMs);
  }
  function connect(url, isReconnect = false) {
    const ws = new WebSocket(url);
    ws.on("message", async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const type = msg.metadata?.message_type;
      if (ws === current) resetWatchdog(ws);
      if (type === "session_welcome") {
        const session = msg.payload.session;
        keepaliveMs = ((session.keepalive_timeout_seconds || 30) + 10) * 1000;
        const old = current;
        current = ws;
        resetWatchdog(ws);
        if (old && old !== ws) old.close();
        if (!isReconnect) {
          try {
            if (!user) user = (await api("/users")).data[0];
            console.log(`[eventsub] connected as ${user.login}`);
            await subscribe("channel.chat.message", { broadcaster_user_id: user.id, user_id: user.id }, session.id);
            await subscribe("channel.raid", { to_broadcaster_user_id: user.id }, session.id);
          } catch (err) {
            console.error("[eventsub] setup failed:", err.message);
            ws.close();
          }
        }
      } else if (type === "notification") {
        const subType = msg.metadata.subscription_type;
        const ev = msg.payload.event;
        if (subType === "channel.chat.message") {
          onEvent({
            type: "chat.message",
            user: ev.chatter_user_name,
            text: String(ev.message?.text ?? "").trim().slice(0, 200),
            ts: Date.now(),
          });
        } else if (subType === "channel.raid") {
          onEvent({ type: "raid", from: ev.from_broadcaster_user_name, viewers: ev.viewers, ts: Date.now() });
        }
      } else if (type === "session_reconnect") {
        connect(msg.payload.session.reconnect_url, true);
      } else if (type === "revocation") {
        console.warn("[eventsub] subscription revoked:", msg.payload?.subscription?.type);
      }
    });
    ws.on("close", (code) => {
      if (current && ws !== current) return;
      current = null;
      clearTimeout(watchdog);
      console.warn(`[eventsub] closed (${code}), retrying in 5s`);
      setTimeout(() => connect(WS_URL, false), 5000);
    });
    ws.on("error", (err) => console.error("[eventsub] socket error:", err.message));
  }
  connect(WS_URL, false);
}