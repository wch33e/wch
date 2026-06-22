import { postJson, renderMessages, subscribe } from "./shared.js";

const messages = document.querySelector("#messages");
const sessionList = document.querySelector("#sessionList");
const activeCount = document.querySelector("#activeCount");
const emptyState = document.querySelector("#emptyState");
const replyInput = document.querySelector("#replyInput");
const replyButton = document.querySelector("#replyButton");
const revealButton = document.querySelector("#revealButton");
const resetButton = document.querySelector("#resetButton");
const selectedUser = document.querySelector("#selectedUser");
const labelInput = document.querySelector("#labelInput");
const labelButton = document.querySelector("#labelButton");
const loginScreen = document.querySelector("#loginScreen");
const loginForm = document.querySelector("#loginForm");
const pinInput = document.querySelector("#pinInput");
const loginButton = document.querySelector("#loginButton");
const loginError = document.querySelector("#loginError");
const logoutButton = document.querySelector("#logoutButton");
const params = new URLSearchParams(window.location.search);
let selectedSessionId = params.get("session") || "";
let adminEvents;
history.replaceState(null, "", "/operator.html");

boot();

async function boot() {
  const response = await fetch("/api/admin-check");
  if (response.ok) {
    loginScreen.hidden = true;
    connectAdmin();
  } else {
    loginScreen.hidden = false;
    pinInput.focus();
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  loginButton.textContent = "验证中...";
  loginError.textContent = "";
  try {
    await postJson("/api/admin-login", { pin: pinInput.value.trim() });
    loginScreen.hidden = true;
    pinInput.value = "";
    connectAdmin();
  } catch {
    loginError.textContent = "PIN 不对，再试一次。";
    pinInput.select();
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "进入后台";
  }
});

function connectAdmin() {
  adminEvents?.close();
  const query = selectedSessionId ? `?session=${encodeURIComponent(selectedSessionId)}` : "";
  adminEvents = subscribe(`/admin-events${query}`, (data) => {
    if (selectedSessionId !== data.selectedId) {
      selectedSessionId = data.selectedId;
      history.replaceState(null, "", "/operator.html");
    }
    renderSessions(data.sessions);
    const selectedSession = data.sessions.find((session) => session.id === data.selectedId);
    activeCount.textContent = String(data.activeCount);
    renderMessages(messages, data.messages || []);
    emptyState.hidden = Boolean(data.selectedId);
    selectedUser.textContent = selectedSession ? `正在回复：${selectedSession.label}` : "未选择用户";
    labelInput.value = selectedSession?.label || "";
    labelInput.disabled = !selectedSession;
    labelButton.disabled = !selectedSession;
    replyInput.disabled = !data.selectedId;
    replyButton.disabled = !data.selectedId;
    revealButton.disabled = !data.selectedId;
    resetButton.disabled = !data.selectedId;
  }, () => {
    loginScreen.hidden = false;
    adminEvents?.close();
  });
}

function renderSessions(sessions) {
  sessionList.innerHTML = "";
  for (const session of sessions) {
    const card = document.createElement("div");
    card.className = `session-card${session.id === selectedSessionId ? " active" : ""}`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "session-select";
    const title = document.createElement("span");
    title.className = "session-card-title";

    const left = document.createElement("span");
    left.className = "session-name";
    const dot = document.createElement("i");
    dot.className = `session-dot ${session.status || "idle"}`;
    const name = document.createElement("span");
    name.textContent = session.label;
    left.append(dot, name);
    title.append(left);

    if (session.unread) {
      const badge = document.createElement("b");
      badge.textContent = String(session.unread);
      title.append(badge);
    }

    const meta = document.createElement("small");
    const statusText = session.status === "running" ? "正在运行" : session.status === "paused" ? "已暂停" : "空闲";
    meta.textContent = `${statusText} · ${session.lastMessage || "刚刚进入"}`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      selectedSessionId = session.id;
      history.replaceState(null, "", "/operator.html");
      selectedUser.textContent = `正在回复：${session.label}`;
      connectAdmin();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "session-delete";
    deleteButton.textContent = "删除";
    deleteButton.setAttribute("aria-label", `删除${session.label}`);
    deleteButton.addEventListener("click", async () => {
      const confirmed = window.confirm(`删除 ${session.label} 和它的聊天记录？`);
      if (!confirmed) return;
      deleteButton.disabled = true;
      await postJson("/api/delete-session", { sessionId: session.id });
      if (selectedSessionId === session.id) {
        selectedSessionId = "";
        history.replaceState(null, "", "/operator.html");
      }
      connectAdmin();
    });

    card.append(button, deleteButton);
    sessionList.append(card);
  }
}

async function sendReply() {
  const text = replyInput.value.trim();
  if (!text || !selectedSessionId) return;
  replyButton.disabled = true;
  replyButton.textContent = "发送中...";
  try {
    await postJson("/api/operator-reply", { text, sessionId: selectedSessionId });
    replyInput.value = "";
    replyInput.focus();
    replyButton.textContent = "已发送";
    window.setTimeout(() => {
      replyButton.textContent = "发送回复";
    }, 650);
  } finally {
    replyButton.disabled = false;
  }
}

replyButton.addEventListener("click", sendReply);
replyInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    sendReply();
  }
});
revealButton.addEventListener("click", () => selectedSessionId && postJson("/api/reveal", { sessionId: selectedSessionId }));
resetButton.addEventListener("click", () => selectedSessionId && postJson("/api/reset", { sessionId: selectedSessionId }));
labelButton.addEventListener("click", async () => {
  const label = labelInput.value.trim();
  if (!selectedSessionId || !label) return;
  labelButton.disabled = true;
  labelButton.textContent = "保存中...";
  try {
    await postJson("/api/session-label", { sessionId: selectedSessionId, label });
    labelButton.textContent = "已保存";
    window.setTimeout(() => {
      labelButton.textContent = "保存";
    }, 650);
  } finally {
    labelButton.disabled = false;
  }
});
labelInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    labelButton.click();
  }
});
logoutButton.addEventListener("click", async () => {
  await postJson("/api/admin-logout");
  adminEvents?.close();
  loginScreen.hidden = false;
  pinInput.focus();
});
