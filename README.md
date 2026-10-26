# streamforge
An AI-driven, secure automation and interaction platform for Twitch creators using OpenAI Codex.

## Chaos Vote

Start the server with `npm start`, then open `http://localhost:3000/control` to start a vote and `http://localhost:3000/overlay` to view it. Viewers vote in chat with `!1`, `!2`, and so on. Set `DEMO=1` in `.env` to include simulated votes while a vote is open.

Run the vote manager tests with `node --test core/vote.test.js`.
