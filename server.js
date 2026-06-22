import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicDir = join(root, "public");
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || (process.env.PORT ? "0.0.0.0" : "127.0.0.1");
const adminPin = process.env.ADMIN_PIN || "246810";
const adminSecret = process.env.ADMIN_SECRET || crypto.randomUUID();

const welcomeText = "你好，我是 Nimbo AI。想聊点什么？";
const sessions = new Map();
const adminClients = new Set();

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || "")
      .split(";")
      .map((cookie) => cookie.trim())
      .filter(Boolean)
      .map((cookie) => {
        const index = cookie.indexOf("=");
        return [cookie.slice(0, index), decodeURIComponent(cookie.slice(index + 1))];
      })
  );
}

function isAdmin(req) {
  return parseCookies(req).nimbo_admin === adminSecret;
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  sendJson(res, 401, { error: "Admin login required." });
  return false;
}

function createWelcome() {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    text: welcomeText,
    at: Date.now()
  };
}

function ensureSession(id) {
  const sessionId = String(id || "").trim().slice(0, 80) || crypto.randomUUID();
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      id: sessionId,
      label: `用户 ${sessions.size + 1}`,
      createdAt: Date.now(),
      lastSeen: Date.now(),
      status: "idle",
      clients: new Set(),
      messages: [createWelcome()]
    });
  }
  const session = sessions.get(sessionId);
  session.lastSeen = Date.now();
  return session;
}

function sessionSummary(session) {
  const lastMessage = session.messages.at(-1);
  const unread = session.messages.filter((message) => message.role === "user" && !message.answered).length;
  return {
    id: session.id,
    label: session.label,
    online: session.clients.size > 0 || Date.now() - session.lastSeen < 45000,
    status: session.status,
    userCount: session.clients.size,
    messageCount: session.messages.length,
    unread,
    lastSeen: session.lastSeen,
    lastMessage: lastMessage?.text || ""
  };
}

function adminPayload(selectedId = "") {
  const list = [...sessions.values()]
    .map(sessionSummary)
    .sort((a, b) => b.lastSeen - a.lastSeen);
  const selected = selectedId && sessions.has(selectedId) ? sessions.get(selectedId) : sessions.get(list[0]?.id);
  return {
    sessions: list,
    activeCount: list.filter((session) => session.online).length,
    selectedId: selected?.id || "",
    selectedStatus: selected?.status || "idle",
    messages: selected?.messages || []
  };
}

function pushSse(clients, body) {
  const payload = `data: ${JSON.stringify(body)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

function broadcastSession(session) {
  pushSse(session.clients, { messages: session.messages, sessionId: session.id, status: session.status });
  broadcastAdmin(session.id);
}

function broadcastAdmin(selectedId = "") {
  pushSse(adminClients, adminPayload(selectedId));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/admin-login") {
    const body = await readBody(req);
    if (String(body.pin || "") !== adminPin) {
      sendJson(res, 401, { error: "PIN is incorrect." });
      return;
    }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": `nimbo_admin=${encodeURIComponent(adminSecret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin-check") {
    sendJson(res, isAdmin(req) ? 200 : 401, { ok: isAdmin(req) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/admin-logout") {
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": "nimbo_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  const routePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = normalize(decodeURIComponent(routePath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(filePath);
    const type =
      {
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".svg": "image/svg+xml; charset=utf-8",
        ".json": "application/json; charset=utf-8"
      }[extname(filePath)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(data);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/events") {
    const session = ensureSession(url.searchParams.get("session"));
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    session.clients.add(res);
    session.lastSeen = Date.now();
    res.write(`data: ${JSON.stringify({ messages: session.messages, sessionId: session.id, status: session.status })}\n\n`);
    broadcastAdmin(session.id);
    req.on("close", () => {
      session.clients.delete(res);
      session.lastSeen = Date.now();
      broadcastAdmin(session.id);
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/admin-events") {
    if (!requireAdmin(req, res)) return;
    const selectedId = url.searchParams.get("session") || "";
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive"
    });
    adminClients.add(res);
    res.write(`data: ${JSON.stringify(adminPayload(selectedId))}\n\n`);
    req.on("close", () => adminClients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/messages") {
    const session = ensureSession(url.searchParams.get("session"));
    sendJson(res, 200, { messages: session.messages, sessionId: session.id, status: session.status });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/admin") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, adminPayload(url.searchParams.get("session") || ""));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/user-message") {
    const body = await readBody(req);
    const session = ensureSession(body.sessionId);
    const text = String(body.text || "").trim().slice(0, 1000);
    if (!text) {
      sendJson(res, 400, { error: "Message is required." });
      return;
    }
    session.status = "running";
    session.messages.push({ id: crypto.randomUUID(), role: "user", text, at: Date.now(), answered: false });
    broadcastSession(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/pause") {
    const body = await readBody(req);
    const session = ensureSession(body.sessionId);
    session.status = "paused";
    broadcastSession(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/operator-reply") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const session = ensureSession(body.sessionId);
    const text = String(body.text || "").trim().slice(0, 1600);
    if (!text) {
      sendJson(res, 400, { error: "Reply is required." });
      return;
    }
    for (const message of session.messages) {
      if (message.role === "user") message.answered = true;
    }
    session.status = "idle";
    session.messages.push({ id: crypto.randomUUID(), role: "assistant", text, at: Date.now() });
    broadcastSession(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reveal") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const session = ensureSession(body.sessionId);
    session.status = "idle";
    session.messages.push({
      id: crypto.randomUUID(),
      role: "system",
      text: "揭晓：这是一个整蛊演示，刚才的回复由真人在后台发送，不是真正的 AI。",
      at: Date.now()
    });
    broadcastSession(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reset") {
    if (!requireAdmin(req, res)) return;
    const body = await readBody(req);
    const session = ensureSession(body.sessionId);
    session.status = "idle";
    session.messages = [createWelcome()];
    broadcastSession(session);
    sendJson(res, 200, { ok: true });
    return;
  }

  serveStatic(req, res);
});

server.listen(port, host, () => {
  console.log(`Nimbo is running at http://localhost:${port}`);
  console.log(`Operator console: http://localhost:${port}/operator.html`);
  if (!process.env.ADMIN_PIN) {
    console.log("Admin PIN: 246810");
  }
});
