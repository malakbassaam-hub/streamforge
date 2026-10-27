const WINDOW_MS = 10 * 60_000;

function safeText(value, limit = 120) {
  return String(value ?? "").replace(/<[^>]*>/g, "")
    .replace(/[<>\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .trim().slice(0, limit);
}

export function isRecapCommand(text) {
  return typeof text === "string" && text.trim().toLowerCase() === "!recap";
}

export function buildRecap(history, now = Date.now()) {
  const events = history.filter(event => {
    const time = event.storedAt ?? event.ts;
    return Number.isFinite(time) && time >= now - WINDOW_MS && time <= now;
  }).sort((a, b) => (a.storedAt ?? a.ts) - (b.storedAt ?? b.ts));
  const chats = events.filter(event => event.type === "chat.message" && !isRecapCommand(event.text));
  const raid = events.findLast(event => event.type === "raid");
  const vote = events.findLast(event => event.type === "vote.result");
  const lines = ["Recap: last 10 minutes"];
  if (!chats.length && !raid && !vote) return [...lines, "Nothing happened yet"];
  const chatters = new Map();
  const minutes = new Map();
  for (const event of chats) {
    const name = safeText(event.user, 80) || "Unknown";
    const key = name.toLowerCase();
    const chatter = chatters.get(key) ?? { name, count: 0 };
    chatter.count++;
    chatters.set(key, chatter);
    const minute = Math.floor((event.storedAt ?? event.ts) / 60_000) * 60_000;
    minutes.set(minute, (minutes.get(minute) ?? 0) + 1);
  }
  lines.push(`Chat: ${chats.length} messages from ${chatters.size} unique chatters`);
  const mostActive = [...chatters.values()].sort((a, b) => b.count - a.count)[0];
  lines.push(mostActive ? `Most active: ${mostActive.name} (${mostActive.count} messages)` : "Most active: none");
  lines.push(raid ? `Latest raid: ${safeText(raid.user, 80) || "Unknown"} (${Number.isSafeInteger(raid.viewers) && raid.viewers >= 0 ? raid.viewers : 0} viewers)` : "Latest raid: none");
  const winner = vote?.winner == null ? "no votes"
    : Array.isArray(vote.winner) ? vote.winner.map(name => safeText(name, 40)).join(" / ") : safeText(vote.winner, 40);
  lines.push(vote ? `Last vote: ${safeText(vote.question) || "Untitled vote"} - ${winner}` : "Last vote: none");
  const peak = [...minutes].sort((a, b) => b[1] - a[1])[0];
  lines.push(peak ? `Chat peak: ${new Date(peak[0]).toISOString().slice(11, 16)} UTC (${peak[1]} messages/min)` : "Chat peak: none");
  return lines;
}

export function createRecapManager(getHistory, publish) {
  let nextAllowedAt = -Infinity;
  return {
    request() {
      const now = Date.now();
      if (now < nextAllowedAt) return { published: false, retryAfterSeconds: Math.ceil((nextAllowedAt - now) / 1000) };
      nextAllowedAt = now + 60_000;
      publish({ type: "recap.card", lines: buildRecap(getHistory(), now), ts: now });
      return { published: true };
    },
  };
}
