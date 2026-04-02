import type { HubWSEvent, HubMessageItem, OpeniLinkConfig } from "./types.js";
import { getPluginRuntime } from "./runtime.js";

export async function handleInboundEvent(
  event: HubWSEvent,
  config: OpeniLinkConfig,
  cfg: any,
  accountId: string,
): Promise<void> {
  const rt = getPluginRuntime();
  if (!rt?.channel) return;
  if (!event?.event?.data) return;

  const eventData = event.event.data;
  const sender = eventData.sender;
  const group = eventData.group;
  const items = eventData.items;
  const rawContent = eventData.content || "";
  const msgType = eventData.msg_type;
  const content = msgType && msgType !== "text"
    ? buildBodyFromItems(rawContent, msgType, items)
    : rawContent;
  const senderId = sender?.id || "unknown";
  const senderName = sender?.name || senderId;
  const isDirect = !group;
  const peerId = isDirect ? senderId : group!.id;

  let route: any;
  try {
    route = rt.channel.routing.resolveAgentRoute({
      cfg,
      channel: "openilink",
      accountId,
      peer: { kind: isDirect ? "direct" : "group", id: peerId },
    });
  } catch (err) {
    console.error("[openilink] Route error:", err);
    return;
  }

  let body: string;
  let ctx: any;
  try {
    const envelopeOptions = rt.channel.reply.resolveEnvelopeFormatOptions(cfg);
    body = rt.channel.reply.formatInboundEnvelope({
      channel: "OpeniLink",
      from: senderName,
      timestamp: event.event.timestamp * 1000,
      body: content,
      chatType: isDirect ? "direct" : "group",
      sender: { name: senderName, id: senderId },
      envelope: envelopeOptions,
    });

    ctx = rt.channel.reply.finalizeInboundContext({
      Body: body,
      RawBody: content,
      CommandBody: content,
      From: peerId,
      To: peerId,
      SessionKey: route.sessionKey,
      AccountId: accountId,
      ChatType: isDirect ? "direct" : "group",
      SenderName: senderName,
      SenderId: senderId,
      Provider: "openilink",
      Surface: "openilink",
      MessageSid: event.event.id || `${event.trace_id}-${Date.now()}`,
      Timestamp: event.event.timestamp * 1000,
      CommandAuthorized: true,
      OriginatingChannel: "openilink",
      OriginatingTo: peerId,
    });
  } catch (err) {
    console.error("[openilink] Context build error:", err);
    return;
  }

  try {
    const storePath = rt.channel.session.resolveStorePath(`openilink/${accountId}`);
    await rt.channel.session.recordInboundSession({
      storePath,
      sessionKey: route.sessionKey,
      ctx,
      onRecordError: (err: unknown) => {
        console.error("[openilink] Session record error:", err);
      },
    });
  } catch (err) {
    console.error("[openilink] Session error:", err);
    return;
  }

  try {
    await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
      ctx,
      cfg,
      dispatcherOptions: {
        responsePrefix: "",
        deliver: async (payload: any) => {
          if (payload.text) {
            await sendToHub(config, payload.text, peerId, event.trace_id);
          }
          if (payload.mediaUrl) {
            await sendToHub(config, payload.mediaUrl, peerId, event.trace_id);
          }
        },
      },
      replyOptions: {},
    });
  } catch (err) {
    console.error("[openilink] Dispatch error:", err);
  }
}

/**
 * Build a human-readable body from event data, incorporating media items.
 * For text messages, returns content as-is.
 * For media messages, appends file/media info so the AI can see what was sent.
 */
export function buildBodyFromItems(
  content: string,
  msgType: string | undefined,
  items: HubMessageItem[] | undefined,
): string {
  if (!items || items.length === 0) return content;

  const parts: string[] = [];

  for (const item of items) {
    switch (item.type) {
      case "text":
        if (item.text) parts.push(item.text);
        break;
      case "file": {
        const name = item.file_name || "file";
        const size = item.media?.file_size
          ? ` (${formatFileSize(item.media.file_size)})`
          : "";
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[File: ${name}${size}]${url}`);
        break;
      }
      case "image": {
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[Image]${url}`);
        break;
      }
      case "voice": {
        const duration = item.media?.play_time
          ? ` ${item.media.play_time}s`
          : "";
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[Voice${duration}]${url}`);
        break;
      }
      case "video": {
        const duration = item.media?.play_length
          ? ` ${item.media.play_length}s`
          : "";
        const url = item.media?.url ? `\n${item.media.url}` : "";
        parts.push(`[Video${duration}]${url}`);
        break;
      }
    }
  }

  return parts.join("\n") || content;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function sendToHub(config: OpeniLinkConfig, content: string, peerId: string, traceId?: string): Promise<void> {
  const body: Record<string, string> = { content, to: peerId };
  if (traceId) body.trace_id = traceId;

  try {
    const resp = await fetch(`${config.hubUrl}/bot/v1/message/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.appToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error(`[openilink] Send failed: ${resp.status} ${text}`);
    }
  } catch (err) {
    console.error("[openilink] Send error:", err);
  }
}
