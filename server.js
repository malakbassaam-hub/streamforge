import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoSimulator } from "./core/demo.js";
import { startEventSub } from "./core/eventsub.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;
const overlayPath = path.join(__dirname, "public", "overlay.html");
const simulator = createDemoSimulator();
const clients = new Set();

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_REDIRECT_URI } = process.env;
if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_REDIRECT_URI) {
  console.warn("WARNING: Twitch variables are missing in .env (CLIENT_ID / CLIENT_SECRET / REDIRECT_URI)");
}

// ---- Event memory (last 100 events, used later by Recap) ----
const eventMemory = [];
const MAX_MEMORY_SIZE = 100;

function addEventToMemory(event) {
  eventMemory.push({ ...event, storedAt: Date.now() });
  if (eventMemory.length > MAX_MEMORY_SIZE) eventMemory.shift();
}

// ---- Token storage (saved to data/tokens.json, which is git-ignored) ----
const DATA_DIR = path.join(__dirname, "data");
const TOKEN_FILE = path.join(DATA_DIR, "tokens.json");

function loadTokens() {
  try {
    return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
  } catch {
    return null;
  }
}

function saveTokens(tokens) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 });
}

let twitchTokens = loadTokens();

function storeTokenResponse(data) {
  twitchTokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    scope: data.scope,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  saveTokens(twitchTokens);
}

// Returns a valid access token, refreshing it automatically when it is about to expire.
async function getValidToken() {
  if (!twitchTokens) return null;
  if (Date.now() < twitchTokens.expiresAt - 60_000) return twitchTokens.accessToken;

  try {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: twitchTokens.refreshToken,
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
      console.error("Token refresh failed:", data.message || data.error);
      twitchTokens = null;
      return null;
    }
    storeTokenResponse(data);
    console.log("Token refreshed.");
    return twitchTokens.accessToken;
  } catch (err) {
    console.error("Token refresh error:", err.message);
    return null;
  }
}

// ---- Publishing events to memory + all connected overlays ----
function publish(event) {
  addEventToMemory(event);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

// ---- Basic routes ----
app.get("/", (_request, response) => {
  response.redirect("/overlay");
});

app.get("/overlay", (_request, response) => {
  response.sendFile(overlayPath);
});

app.get("/events", (_request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.flushHeaders();
  response.write(": connected\n\n");
  clients.add(response);

  response.on("close", () => {
    clients.delete(response);
  });
});

// Debug endpoints (never expose the tokens themselves)
app.get("/api/memory", (_req, res) => {
  res.json({ count: eventMemory.length, events: eventMemory });
});

app.get("/auth/status", async (_req, res) => {
  const token = await getValidToken();
  res.json({
    connected: Boolean(token),
    scope: twitchTokens?.scope ?? null,
    expiresInMinutes: twitchTokens ? Math.round((twitchTokens.expiresAt - Date.now()) / 60000) : null,
  });
});

// ---- Demo simulator (disable with DEMO=0 in .env) ----
if (process.env.DEMO !== "0") {
  simulator.events.on("event", publish);
  simulator.start();
}

// ---- Real Twitch events ----
function launchEventSub() {
  if (!twitchTokens) return;
  startEventSub({ clientId: TWITCH_CLIENT_ID, getValidToken, onEvent: publish });
}

// ---- Twitch OAuth ----
const pendingStates = new Set();

app.get("/auth/twitch", (_req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  pendingStates.add(state);
  const params = new URLSearchParams({
    client_id: TWITCH_CLIENT_ID ?? "",
    redirect_uri: TWITCH_REDIRECT_URI ?? "",
    response_type: "code",
    scope: "user:read:chat user:write:chat channel:manage:broadcast",
    state,
  });
  res.redirect(`https://id.twitch.tv/oauth2/authorize?${params}`);
});

app.get("/auth/callback", async (req, res) => {
  const { code, state, error } = req.query;
  if (error) return res.status(400).send("Twitch returned an error: " + String(error));
  if (!code) return res.status(400).send("Authorization code missing!");
  if (!pendingStates.delete(state)) return res.status(400).send("Invalid state. Start again from /auth/twitch");

  try {
    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: TWITCH_CLIENT_ID,
        client_secret: TWITCH_CLIENT_SECRET,
        code: String(code),
        grant_type: "authorization_code",
        redirect_uri: TWITCH_REDIRECT_URI,
      }),
    });

    const data = await response.json();
    if (data.access_token) {
      storeTokenResponse(data);
      console.log("Auth OK. Granted scopes:", data.scope); // never log the tokens themselves
      launchEventSub();
      res.send(`<h1>Authentication Successful</h1><p>Connected and tokens saved.</p><a href="/overlay">Go to Overlay</a>`);
    } else {
      console.error("Token exchange failed:", data.message || data.error);
      res.status(400).send("Failed to get token. Check the terminal for details.");
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal Server Error during authentication");
  }
});

app.listen(port, () => {
  console.log(`StreamForge demo server listening at http://localhost:${port}`);
  launchEventSub();
});