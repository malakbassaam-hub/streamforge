import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDemoSimulator } from "./core/demo.js";

const app = express();
const port = Number(process.env.PORT) || 3000;
const overlayPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "public", "overlay.html");
const simulator = createDemoSimulator();
const clients = new Set();

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

app.listen(port, "127.0.0.1", () => {
  console.log(`StreamForge demo server listening at http://127.0.0.1:${port}`);
});