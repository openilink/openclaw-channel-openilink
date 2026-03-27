import type { HubWSEvent, OpeniLinkConfig } from "./types.js";
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
  const content = eventData.content || "";
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
