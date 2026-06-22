export function renderMessages(container, messages) {
  container.innerHTML = "";
  for (const message of messages) {
    const item = document.createElement("article");
    item.className = `message ${message.role}`;
    item.textContent = message.text;
    container.append(item);
  }
  container.scrollTop = container.scrollHeight;
}

export function subscribe(url, onData, onError) {
  const events = new EventSource(url);
  events.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    onData(data);
  });
  events.addEventListener("error", () => {
    onError?.();
  });
  return events;
}

export async function postJson(url, body = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}
