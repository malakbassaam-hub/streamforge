import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoSimulator } from "./core/demo.js";
import { startEventSub } from "./core/eventsub.js";
import { scanPlugins, scanPluginStatus, watchPlugins } from "./core/plugins.js";
import { forgeContract, requireLoopback, createForgeTester } from "./core/forge.js";
import { createEventHandler } from "./core/events.js";
import { createRecapManager, isRecapCommand } from "./core/recap.js";
import { createSnapshotStore } from "./core/snapshot.js";
import { requireLocalHost } from "./core/host.js";
import { createVoteManager, VoteInputError } from "./core/vote.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || "127.0.0.1";
const overlayPath = path.join(__dirname, "public", "overlay.html");
const controlPath = path.join(__dirname, "public", "control.html");
const pluginsPath = path.join(__dirname, "plugins");
const clients = new Set();
const snapshotStore = createSnapshotStore();
app.use(requireLocalHost);
app.use(express.static(path.join(__dirname, "public")));

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
  snapshotStore.record(event);
  addEventToMemory(event);
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

const pluginWatcher = watchPlugins(pluginsPath, () => publish({ type: "plugins.changed" }));

const voteManager = createVoteManager(publish);
const demoVoteOptions = process.env.DEMO === "1"
  ? {
      isVoteOpen: () => voteManager.isOpen(),
      onDemoVote: (user, text) => handleEvent({ type: "chat.message", user, text, ts: Date.now() }),
    }
  : {};
const simulator = createDemoSimulator(demoVoteOptions);

const recapManager = createRecapManager(() => eventMemory, publish);
const handleEvent = createEventHandler(voteManager, publish, () => {
  voteManager.isOpen();
  recapManager.request();
});

app.post(["/api/demo/recap", "/api/demo/chat"], (request, response, next) => {
  const address = request.socket.remoteAddress ?? "";
  if (!(address === "::1" || address.startsWith("127.") || /^::ffff:127(?:\.\d{1,3}){3}$/i.test(address))) {
    return response.status(403).json({ error: "This endpoint is available from localhost only." });
  }
  if (process.env.DEMO !== "1") return response.status(404).json({ error: "Enable DEMO=1 to test recaps." });
  next();
}, express.json(), (request, response) => {
  if (request.path === "/api/demo/chat" && !isRecapCommand(request.body?.text)) {
    return response.status(400).json({ error: "Enter !recap to test a recap." });
  }
  voteManager.isOpen();
  const result = recapManager.request();
  if (!result.published) response.set("Retry-After", String(result.retryAfterSeconds));
  response.status(result.published ? 201 : 429).json(result);
});

const forgeTester = createForgeTester(handleEvent);
app.get("/api/forge/contract", requireLoopback, (_request, response) => {
  response.json(forgeContract(__dirname));
});
app.get("/api/plugins/status", requireLoopback, (_request, response) => {
  response.json(scanPluginStatus(pluginsPath));
});
app.post("/api/forge/test", requireLoopback, (_request, response) => {
  const result = forgeTester.start();
  if (!result.started) response.set("Retry-After", String(result.retryAfterSeconds));
  response.status(result.started ? 202 : 429).json(result);
});

// ---- Basic routes ----
app.get("/", (_request, response) => {
  response.redirect("/overlay");
});

app.get("/overlay", (_request, response) => {
  response.sendFile(overlayPath);
});

app.get("/control", (_request, response) => {
  response.sendFile(controlPath);
});

app.get("/api/plugins", (_request, response) => {
  response.json(scanPlugins(pluginsPath));
});

app.get("/plugins/:name/plugin.html", (request, response, next) => {
  const plugin = scanPlugins(pluginsPath).find(({ name }) => name === request.params.name);
  if (!plugin) {
    response.sendStatus(404);
    return;
  }

  response.set(
    "Content-Security-Policy",
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'",
  );
  response.sendFile(path.join(pluginsPath, plugin.name, "plugin.html"), (error) => {
    if (error) next(error);
  });
});

app.post("/api/vote/start", (request, response, next) => {
  const address = request.socket.remoteAddress ?? "";
  const isLoopback = address === "::1"
    || address.startsWith("127.")
    || /^::ffff:127(?:\.\d{1,3}){3}$/i.test(address);
  if (isLoopback) {
    next();
    return;
  }
  response.status(403).json({ error: "This endpoint is available from localhost only." });
}, express.json(), (request, response) => {
  const { question, options, durationSeconds } = request.body ?? {};
  try {
    voteManager.start(question, options, durationSeconds);
    response.status(201).json({ started: true });
  } catch (error) {
    if (!(error instanceof VoteInputError)) throw error;
    response.status(400).json({ error: error.message });
  }
});

app.get("/events", (_request, response) => {
  response.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.flushHeaders();
  voteManager.isOpen(); // Finish an expired vote before taking its snapshot.
  response.write(`data: ${JSON.stringify(snapshotStore.getSnapshot())}\n\n`);
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
  simulator.events.on("event", handleEvent);
  simulator.start();
  publish(snapshotStore.setStatus({ demo: true }));
}

// ---- Real Twitch events ----
function launchEventSub() {
  if (!twitchTokens) return;
  startEventSub({ clientId: TWITCH_CLIENT_ID, getValidToken, onEvent: handleEvent,
    onStatusChange: live => publish(snapshotStore.setStatus({ live })),
  });
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

const server = app.listen(port, host, () => {
  console.log(`StreamForge demo server listening at http://${host}:${port}`);
  launchEventSub();
});
server.on("close", () => { pluginWatcher.close(); forgeTester.stop(); });
