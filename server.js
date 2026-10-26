import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoSimulator } from "./core/demo.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const overlayPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "public", "overlay.html");
const simulator = createDemoSimulator();
const clients = new Set();

const { TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, TWITCH_REDIRECT_URI } = process.env;
if (!TWITCH_CLIENT_ID || !TWITCH_CLIENT_SECRET || !TWITCH_REDIRECT_URI) {
  console.warn("WARNING: Twitch variables are missing in .env (CLIENT_ID / CLIENT_SECRET / REDIRECT_URI)");
}

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

simulator.events.on("event", (event) => {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
});

simulator.start();

// ---- Twitch OAuth (basic connection test, no token storage yet) ----
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
      console.log("Auth OK. Granted scopes:", data.scope); // never log the tokens themselves
      res.send(`<h1>Authentication Successful</h1><p>Connected to Twitch.</p><a href="/overlay">Go to Overlay</a>`);
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
});