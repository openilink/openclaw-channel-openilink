import type { OpeniLinkConfig } from "./types.js";

export function createOutboundAdapter(resolveConfig: (cfg: any, accountId?: string | null) => OpeniLinkConfig) {
  return {
    deliveryMode: "direct" as const,

    async sendText(ctx: any): Promise<any> {
      const config = resolveConfig(ctx.cfg, ctx.accountId);
      const body: Record<string, string> = { content: ctx.text };

      const resp = await fetch(`${config.hubUrl}/bot/v1/message/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.appToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        return { ok: false, error: `Hub returned ${resp.status}` };
      }

      const result = await resp.json();
      return { ok: true, messageId: result.client_id };
    },

    async sendMedia(ctx: any): Promise<any> {
      const config = resolveConfig(ctx.cfg, ctx.accountId);
      const body: Record<string, string> = {
        content: ctx.text || "",
        type: "image",
        url: ctx.mediaUrl || "",
      };

      const resp = await fetch(`${config.hubUrl}/bot/v1/message/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.appToken}`,
        },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        return { ok: false, error: `Hub returned ${resp.status}` };
      }

      const result = await resp.json();
      return { ok: true, messageId: result.client_id };
    },
  };
}
