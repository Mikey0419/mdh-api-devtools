/**
 * MDH-API — team chat.
 *
 * A single shared room ("chat:workspace") for everyone signed in. Identity
 * comes from the Auth0 session app.js already establishes: this module never
 * asks for a name or room, it just waits for the `mdh:authenticated` event
 * app.js dispatches and starts from there.
 *
 * The Ably token comes from /api/chat-token, which requires the same Auth0
 * access token dashboard.js already uses for cross-device sync — so chat and
 * dashboard sync succeed or fail together for the same underlying reason.
 */
(function () {
  "use strict";

  const root = document.querySelector("#chat");
  if (!root) return;

  const ROOM_NAME = "chat:workspace";
  const HISTORY_LIMIT = 50;

  const connectionEl = root.querySelector("#chat-connection");
  const messagesEl = root.querySelector("#chat-messages");
  const membersEl = root.querySelector("#chat-members");
  const onlineCountEl = root.querySelector("#chat-online-count");
  const typingEl = root.querySelector("#chat-typing");
  const composerEl = root.querySelector("#chat-composer");
  const inputEl = root.querySelector("#chat-input");
  const sendButton = composerEl.querySelector("button");

  let room;
  let myClientId = "";
  const rendered = new Map(); // message serial -> <li>
  const namesByClientId = new Map(); // clientId -> display name, from presence

  function setConnection(label, live) {
    connectionEl.lastChild.textContent = ` ${label}`;
    connectionEl.classList.toggle("live", live);
  }

  function nameFor(clientId) {
    return namesByClientId.get(clientId) || clientId;
  }

  // Sign out navigates the whole page via Auth0's logout redirect, which
  // just drops the connection -- Ably then takes ~15s to notice an abrupt
  // disconnect and remove the presence entry. Leaving explicitly before that
  // navigation starts clears it immediately for everyone else instead.
  // Capture phase so this runs before app.js's own click handler on the same
  // button, which is what actually starts the redirect.
  document.addEventListener(
    "click",
    (event) => {
      if (room && event.target.closest("#auth-logout")) {
        room.presence.leave().catch(() => {});
      }
    },
    true
  );

  window.addEventListener("mdh:authenticated", (event) => {
    const { user, token } = event.detail;
    if (!token) {
      setConnection("Chat needs the MDH-API Auth0 API enabled (same requirement as cross-device sync)", false);
      return;
    }
    start(user, token).catch((error) => {
      console.error("Chat failed to start:", error);
      setConnection(error.message || "Chat could not connect.", false);
    });
  });

  async function start(user, accessToken) {
    myClientId = user.sub;
    setConnection("Connecting…", false);

    const realtime = new Ably.Realtime({
      authCallback: async (_tokenParams, callback) => {
        try {
          const response = await fetch("/api/chat-token", {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `Auth failed (${response.status})`);
          }
          callback(null, await response.text());
        } catch (error) {
          callback(error, null);
        }
      },
    });

    const chatClient = new AblyChat.ChatClient(realtime);
    chatClient.connection.onStatusChange((change) => {
      if (change.current === "connected") setConnection("Live", true);
      else if (change.current === "disconnected" || change.current === "suspended") setConnection("Reconnecting…", false);
      else if (change.current === "failed") setConnection("Connection failed.", false);
    });

    room = await chatClient.rooms.get(ROOM_NAME, {
      typing: { heartbeatThrottleMs: 5000 },
    });

    // Subscribe before attach — attaching first can silently drop messages
    // that arrive while the attach is still in flight.
    const { historyBeforeSubscribe } = room.messages.subscribe(onMessageEvent);
    room.presence.subscribe(onPresenceEvent);
    room.typing.subscribe(onTypingEvent);

    await room.attach();

    const history = await historyBeforeSubscribe({ limit: HISTORY_LIMIT });
    for (const message of history.items) prependMessage(message);
    scrollToBottom();

    const displayName = (user.name || user.nickname || user.email || "Someone").trim();
    namesByClientId.set(myClientId, displayName);
    await room.presence.enter({ name: displayName });
    await refreshMembers();

    inputEl.disabled = false;
    sendButton.disabled = false;
    inputEl.focus();
  }

  /* ---------------------------------------------------------------- messages */

  function onMessageEvent(event) {
    const { message } = event;
    switch (event.type) {
      case AblyChat.ChatMessageEventType.Created:
        appendMessage(message);
        break;
      case AblyChat.ChatMessageEventType.Updated: {
        const node = rendered.get(message.serial);
        if (node) {
          node.querySelector(".text").textContent = message.text;
          node.classList.add("edited");
        }
        break;
      }
      case AblyChat.ChatMessageEventType.Deleted: {
        rendered.get(message.serial)?.remove();
        rendered.delete(message.serial);
        break;
      }
    }
  }

  function buildMessage(message) {
    const li = document.createElement("li");
    li.className = message.clientId === myClientId ? "chat-message own" : "chat-message";

    const meta = document.createElement("div");
    meta.className = "meta";
    const who = document.createElement("b");
    who.textContent = nameFor(message.clientId);
    const when = document.createElement("time");
    when.dateTime = message.timestamp.toISOString();
    when.textContent = message.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    meta.append(who, when);

    const text = document.createElement("div");
    text.className = "text";
    text.textContent = message.text; // textContent only — this is user input

    li.append(meta, text);
    return li;
  }

  function isNearBottom() {
    return messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 80;
  }

  function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function appendMessage(message) {
    if (rendered.has(message.serial)) return;
    const stick = isNearBottom();
    const node = buildMessage(message);
    rendered.set(message.serial, node);
    messagesEl.append(node);
    if (stick) scrollToBottom();
  }

  function prependMessage(message) {
    if (rendered.has(message.serial)) return;
    const node = buildMessage(message);
    rendered.set(message.serial, node);
    messagesEl.prepend(node);
  }

  composerEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = inputEl.value.trim();
    if (!text || !room) return;
    inputEl.value = "";
    try {
      await room.messages.send({ text });
      await room.typing.stop();
    } catch (error) {
      console.error("Failed to send message:", error);
      inputEl.value = text;
    }
  });

  inputEl.addEventListener("input", () => {
    if (!room) return;
    const signal = inputEl.value ? room.typing.keystroke() : room.typing.stop();
    signal.catch((error) => console.error("Typing indicator failed:", error));
  });

  /* ---------------------------------------------------------------- presence */

  function onPresenceEvent(event) {
    const { clientId, data } = event.member;
    if (data?.name) namesByClientId.set(clientId, data.name);

    if (event.type === AblyChat.PresenceEventType.Enter && clientId !== myClientId) appendNotice(`${nameFor(clientId)} joined`);
    else if (event.type === AblyChat.PresenceEventType.Leave && clientId !== myClientId) appendNotice(`${nameFor(clientId)} left`);

    refreshMembers();
  }

  async function refreshMembers() {
    if (!room) return;
    try {
      const members = await room.presence.get();
      const seen = new Set();
      const rows = [];
      for (const member of members) {
        if (seen.has(member.clientId)) continue;
        seen.add(member.clientId);
        if (member.data?.name) namesByClientId.set(member.clientId, member.data.name);
        rows.push(member.clientId);
      }
      rows.sort((a, b) => nameFor(a).localeCompare(nameFor(b)));

      onlineCountEl.textContent = String(rows.length);
      membersEl.textContent = "";
      if (!rows.length) {
        const empty = document.createElement("li");
        empty.className = "chat-empty";
        empty.textContent = "No one online.";
        membersEl.append(empty);
        return;
      }
      for (const clientId of rows) {
        const li = document.createElement("li");
        li.textContent = nameFor(clientId);
        if (clientId === myClientId) li.classList.add("me");
        membersEl.append(li);
      }
    } catch (error) {
      console.error("Failed to read the presence set:", error);
    }
  }

  function appendNotice(text) {
    const stick = isNearBottom();
    const li = document.createElement("li");
    li.className = "chat-notice";
    li.textContent = text;
    messagesEl.append(li);
    if (stick) scrollToBottom();
  }

  /* ------------------------------------------------------------------ typing */

  function onTypingEvent(event) {
    const others = Array.from(event.currentTypers)
      .map((member) => member.clientId)
      .filter((clientId) => clientId !== myClientId);

    if (others.length === 0) typingEl.innerHTML = "&nbsp;";
    else if (others.length === 1) typingEl.textContent = `${nameFor(others[0])} is typing…`;
    else if (others.length === 2) typingEl.textContent = `${nameFor(others[0])} and ${nameFor(others[1])} are typing…`;
    else typingEl.textContent = `${others.length} people are typing…`;
  }
})();
