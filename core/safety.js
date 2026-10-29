import fs from "node:fs";
import { createHash } from "node:crypto";

export function loadBlocklist(file = new URL("../config/blocklist.txt", import.meta.url)) {
  return fs.readFileSync(file, "utf8").split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !line.startsWith("#"));
}

const defaultTerms = loadBlocklist();
const LOOK_ALIKES = {
  "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "х": "x", "у": "y", "і": "i", "ј": "j", "ѕ": "s", "һ": "h", "ԁ": "d",
  "α": "a", "ε": "e", "ι": "i", "ο": "o", "ρ": "p", "τ": "t", "χ": "x",
  "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b",
  "أ": "ا", "إ": "ا", "آ": "ا", "ٱ": "ا", "ى": "ي", "ی": "ي", "ک": "ك",
};

export function normalizedMatch(text) {
  return text.normalize("NFKD").toLowerCase().replace(/[\p{M}\u0640]/gu, "")
    .replace(/./gu, character => LOOK_ALIKES[character] ?? character)
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function analyzeChat(value, terms) {
  const reasons = [];
  let text = typeof value === "string" ? value.normalize("NFKC") : "";
  // Preserve word boundaries for whitespace controls; remove invisible formatting.
  const visible = text.replace(/\s/gu, " ").replace(/[\p{Cc}\p{Cf}\u034f]/gu, "");
  if (visible !== text) reasons.push("invisible_characters");
  text = visible.replace(/\s+/gu, " ").trim();
  const normalized = normalizedMatch(text);
  if (terms.some(term => term && normalized.includes(term))) reasons.push("blocklist");
  const letters = [...text].filter(letter => letter.toLowerCase() !== letter.toUpperCase());
  if (letters.length >= 12 && letters.filter(letter => letter === letter.toUpperCase()).length / letters.length >= 0.9) reasons.push("caps_spam");
  let linksRemoved = 0;
  text = text.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s]+|\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?:[/:?#][^\s]*)?/giu, () => {
    linksRemoved++;
    return "[link]";
  });
  if (linksRemoved) reasons.push("links_removed");
  const collapsed = text.replace(/(.)\1{4,}/gu, "$1$1$1$1");
  if (collapsed !== text) reasons.push("repeated_characters");
  text = [...collapsed].slice(0, 200).join("");
  const flagged = reasons.includes("blocklist") || reasons.includes("caps_spam");
  const fingerprint = normalized || text.toLowerCase();
  return { text: flagged ? "" : text, flagged, reasons, linksRemoved,
    fingerprint: fingerprint ? createHash("sha256").update(fingerprint).digest("hex") : "" };
}

export function sanitizeChat(text, { terms = defaultTerms } = {}) {
  const { text: clean, flagged, reasons } = analyzeChat(text, terms.map(normalizedMatch).filter(Boolean));
  return { text: clean, flagged, reasons };
}

export function createChatFilter({ terms = defaultTerms } = {}) {
  const normalizedTerms = terms.map(normalizedMatch).filter(Boolean);
  const users = new Map();
  const stats = { blocked: 0, linksRemoved: 0, byReason: {} };
  return {
    sanitizeChat(text, user = "") {
      const now = Date.now();
      const result = analyzeChat(text, normalizedTerms);
      const key = String(user).normalize("NFKC").trim().toLowerCase().slice(0, 100);
      if (key && result.fingerprint) {
        // Expire idle users and cap retained identities and per-user attempts.
        for (const [name, state] of users) if (now - state.lastAt >= 30_000) users.delete(name);
        if (!users.has(key) && users.size >= 5000) users.delete(users.keys().next().value);
        const state = users.get(key) ?? { attempts: [], recent: [], lastAt: now };
        state.attempts = state.attempts.filter(time => now - time < 10_000);
        state.recent = state.recent.filter(entry => now - entry.at < 30_000);
        if (state.attempts.length >= 5) result.reasons.push("rate_limit");
        if (state.recent.filter(entry => entry.text === result.fingerprint).length >= 2) result.reasons.push("repeated_message");
        state.attempts.push(now);
        state.attempts = state.attempts.slice(-5);
        state.recent.push({ text: result.fingerprint.slice(0, 400), at: now });
        state.recent = state.recent.slice(-20);
        state.lastAt = now;
        users.set(key, state);
      }
      result.flagged ||= result.reasons.includes("rate_limit") || result.reasons.includes("repeated_message");
      if (result.flagged) { stats.blocked++; result.text = ""; }
      stats.linksRemoved += result.linksRemoved;
      for (const reason of result.reasons) stats.byReason[reason] = (stats.byReason[reason] ?? 0) + 1;
      return { text: result.text, flagged: result.flagged, reasons: result.reasons };
    },
    getStats() { return structuredClone(stats); },
  };
}

export function sanitizeChatText(value) {
  return sanitizeChat(value).text;
}
