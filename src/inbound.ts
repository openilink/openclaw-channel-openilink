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

  const eventData = event.event.data;
  const sender = eventData.sender;
  const group = eventData.group;
  const content = eventData.content || "";
  const senderId = sender?.id || "unknown";
  const senderName = sender?.name || senderId;
  const isDirect = !group;
  const peerId = isDirect ? senderId : group!.id;

  // Resolve agent route
  const route = rt.channel.routing.resolveAgentRoute({
    cfg,
    channel: "openilink",
    accountId,
    peer: { kind: isDirect ? "direct" : "group", id: peerId },
  });

  // Format inbound envelope
  const envelopeOptions = rt.channel.reply.resolveEnvelopeFormatOptions(cfg);
  const body = rt.channel.reply.formatInboundEnvelope({
    channel: "OpeniLink",
    from: senderName,
    timestamp: event.event.timestamp * 1000,
    body: content,
    chatType: isDirect ? "direct" : "group",
    sender: { name: senderName, id: senderId },
    envelope: envelopeOptions,
  });

  // Build inbound context
  const ctx = rt.channel.reply.finalizeInboundContext({
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

  // Record inbound session
  const storePath = rt.channel.session.resolveStorePath(`openilink/${accountId}`);
  await rt.channel.session.recordInboundSession({
    storePath,
    sessionKey: route.sessionKey,
    ctx,
    onRecordError: (err: unknown) => {
      console.error("[openilink] Session record error:", err);
    },
  });

  // Dispatch to AI and deliver response
  await rt.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      responsePrefix: "",
      deliver: async (payload: any) => {
        // Send AI response back to Hub
        if (payload.text) {
          await sendToHub(config, payload.text, event.trace_id);
        }
        if (payload.mediaUrl) {
          await sendToHub(config, payload.mediaUrl, event.trace_id);
        }
      },
    },
    replyOptions: {},
  });
}

async function sendToHub(config: OpeniLinkConfig, content: string, traceId?: string): Promise<void> {
  const body: Record<string, string> = { content };
  if (traceId) body.trace_id = traceId;

  const resp = await fetch(`${config.hubUrl}/bot/v1/message/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.appToken}`,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[openilink] Send failed: ${resp.status} ${text}`);
  }
}
