import { postJson, renderMessages, subscribe } from "./shared.js";

const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const portalOverlay = document.querySelector("#portalOverlay");
const sessionIdKey = "nimbo-session-id";
let sessionId = localStorage.getItem(sessionIdKey);
let userEvents;

function createSessionId() {
  sessionId = crypto.randomUUID();
  localStorage.setItem(sessionIdKey, sessionId);
}

if (!sessionId) {
  createSessionId();
}
let emptyClicks = [];
let currentStatus = "idle";

connectUser();

function connectUser() {
  userEvents?.close();
  userEvents = subscribe(`/events?session=${encodeURIComponent(sessionId)}`, ({ deleted, messages: items, status }) => {
    if (deleted) {
      createSessionId();
      connectUser();
      return;
    }
    currentStatus = status || "idle";
    renderMessages(messages, items);
    const running = currentStatus === "running";
    sendButton.classList.toggle("waiting", running);
    sendButton.disabled = false;
    sendButton.setAttribute("aria-label", running ? "暂停" : "发送");
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (currentStatus === "running") {
    await postJson("/api/pause", { sessionId });
    return;
  }

  if (!text) {
    registerEmptyClick();
    return;
  }

  input.value = "";
  input.disabled = true;
  try {
    await postJson("/api/user-message", { text, sessionId });
  } finally {
    input.disabled = false;
    input.focus();
  }
});

function registerEmptyClick() {
  const now = Date.now();
  emptyClicks = [...emptyClicks.filter((time) => now - time < 3000), now];
  sendButton.classList.add("pulse");
  window.setTimeout(() => sendButton.classList.remove("pulse"), 180);
  if (emptyClicks.length >= 5) {
    portalOverlay.classList.add("active");
    window.setTimeout(() => {
      window.location.href = "/operator.html";
    }, 720);
  }
}
