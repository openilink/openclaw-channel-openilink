import type { OpeniLinkConfig } from "./types.js";

export function createOutboundAdapter(resolveConfig: (cfg: any, accountId?: string | null) => OpeniLinkConfig) {
  return {
    deliveryMode: "direct" as const,

    async sendText(ctx: any): Promise<any> {
      const config = resolveConfig(ctx.cfg, ctx.accountId);
      const body: Record<string, string> = { content: ctx.text };
      if (ctx.to) body.to = ctx.to;

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
          return { ok: false, error: `Hub returned ${resp.status}` };
        }

        const result = await resp.json();
        return { ok: true, messageId: result.client_id };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },

    async sendMedia(ctx: any): Promise<any> {
      const config = resolveConfig(ctx.cfg, ctx.accountId);
      const body: Record<string, string> = {
        content: ctx.text || "",
        type: "image",
        url: ctx.mediaUrl || "",
      };
      if (ctx.to) body.to = ctx.to;

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
          return { ok: false, error: `Hub returned ${resp.status}` };
        }

        const result = await resp.json();
        return { ok: true, messageId: result.client_id };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    },
  };
}
