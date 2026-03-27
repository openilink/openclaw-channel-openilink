/**
 * Mock LLM server — OpenAI-compatible /v1/chat/completions
 *
 * Pass expected response via header:
 *   X-Mock-Response: "your canned reply"
 *
 * If no header, echoes back the last user message prefixed with "[echo]".
 * Supports both non-streaming and streaming (SSE) modes.
 */

import { createServer } from "node:http";

const PORT = process.env.MOCK_LLM_PORT || 9100;

const server = createServer((req, res) => {
  // Health check
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end("ok");
    return;
  }

  // Models list (some frameworks query this on init)
  if (req.method === "GET" && req.url === "/v1/models") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: [{ id: "mock-model", object: "model", owned_by: "mock" }],
    }));
    return;
  }

  // Chat completions
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
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

      const mockResponse = req.headers["x-mock-response"];
      const lastUserMsg = [...(parsed.messages || [])]
        .reverse()
        .find((m) => m.role === "user");
      const content = mockResponse || `[echo] ${lastUserMsg?.content || ""}`;

      const stream = parsed.stream === true;

      if (!stream) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          id: `chatcmpl-mock-${Date.now()}`,
          object: "chat.completion",
          model: parsed.model || "mock-model",
          choices: [{
            index: 0,
            message: { role: "assistant", content },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        }));
        return;
      }

      // Streaming (SSE)
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const id = `chatcmpl-mock-${Date.now()}`;

      // Send content in one chunk
      res.write(`data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        model: parsed.model || "mock-model",
        choices: [{
          index: 0,
          delta: { role: "assistant", content },
          finish_reason: null,
        }],
      })}\n\n`);

      // Send stop
      res.write(`data: ${JSON.stringify({
        id,
        object: "chat.completion.chunk",
        model: parsed.model || "mock-model",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
      })}\n\n`);

      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }

  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[mock-llm] listening on :${PORT}`);
});
