/**
 * Mock OpeniLink Hub — simulates the Hub side for plugin integration testing.
 *
 * WebSocket: /bot/v1/ws  — sends init + a test message event
 * HTTP POST: /bot/v1/message/send — captures outbound replies
 *
 * Env vars:
 *   MOCK_HUB_PORT       — HTTP + WS port (default 9200)
 *   MOCK_HUB_MESSAGE    — inbound message text (default "hello from test")
 *   MOCK_HUB_SENDER_ID  — sender id (default "test-user-1")
 *   MOCK_HUB_SENDER_NAME — sender name (default "TestUser")
 *   MOCK_HUB_PEER_ID    — peer/chat id (default "test-user-1")
 *   MOCK_HUB_GROUP      — if set, treat as group message with this group id
 */

import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = process.env.MOCK_HUB_PORT || 9200;

const replies = [];

// --- HTTP server ---
const httpServer = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  if (req.method === "GET" && req.url === "/replies") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(replies));
    return;
  }

  if (req.method === "POST" && req.url === "/bot/v1/message/send") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "invalid JSON" }));
        return;
      }

      console.log(`[mock-hub] Received reply: ${JSON.stringify(parsed)}`);
      replies.push(parsed);

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, message_id: `msg-${Date.now()}` }));
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

// --- WebSocket server ---
const wss = new WebSocketServer({ server: httpServer, path: "/bot/v1/ws" });

wss.on("connection", (ws, req) => {
  console.log("[mock-hub] WS client connected");

  // Send init
  ws.send(JSON.stringify({
    type: "init",
    data: {
      bot_id: "mock-bot-1",
      app_slug: "mock-app",
    },
  }));

  // Send a test message event after a short delay
  setTimeout(() => {
    const senderId = process.env.MOCK_HUB_SENDER_ID || "test-user-1";
    const senderName = process.env.MOCK_HUB_SENDER_NAME || "TestUser";
    const peerId = process.env.MOCK_HUB_PEER_ID || senderId;
    const messageText = process.env.MOCK_HUB_MESSAGE || "hello from test";
    const groupId = process.env.MOCK_HUB_GROUP || null;

    const event = {
      type: "event",
      v: 1,
      trace_id: `trace-${Date.now()}`,
      installation_id: "mock-installation-1",
      bot: { id: "mock-bot-1" },
      event: {
        type: "message",
        id: `evt-${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000),
        data: {
          sender: { id: senderId, name: senderName },
          group: groupId ? { id: groupId, name: "TestGroup" } : null,
          content: messageText,
        },
      },
    };

    console.log(`[mock-hub] Sending test event: ${messageText}`);
    ws.send(JSON.stringify(event));
  }, 500);

  // Handle pings
  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    } catch (err) {
      console.log(`[mock-hub] Non-JSON WS message: ${data.toString()}`);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`[mock-hub] listening on :${PORT}`);
});

process.on("SIGTERM", () => {
  wss.clients.forEach((ws) => ws.close());
  wss.close();
  httpServer.close();
});
