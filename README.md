# Nimbo AI

A small Node.js realtime chat demo with a public chat page and an operator console.

## Local

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

## Deploy

This app needs a Node web service because it uses server-sent events and in-memory sessions.

- Render: connect the GitHub repo and Render will read `render.yaml`.
- Railway: connect the GitHub repo or deploy with the Railway CLI.
- Fly.io: use the included `Dockerfile`.

Set `ADMIN_PIN` in the hosting platform's environment variables before sharing the admin page.
