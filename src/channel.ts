import type { OpeniLinkConfig } from "./types.js";
import { resolveConfig, listAccountIds, isConfigured } from "./config.js";
import { startAccount, stopAccount } from "./gateway.js";
import { createOutboundAdapter } from "./outbound.js";

export const openiLinkChannel = {
  id: "openilink" as any,

  meta: {
    id: "openilink" as any,
    label: "OpeniLink Hub",
    selectionLabel: "OpeniLink Hub (WeChat Bridge)",
    docsPath: "channels/openilink",
    blurb: "Send and receive WeChat messages via OpeniLink Hub",
  },

  capabilities: {
    chatTypes: ["direct", "group"] as Array<"direct" | "group">,
    media: true,
  },

  config: {
    listAccountIds: (cfg: any) => listAccountIds(cfg),
    resolveAccount: (cfg: any, accountId?: string | null) => resolveConfig(cfg, accountId),
    isConfigured: (account: OpeniLinkConfig) => !!(account.hubUrl && account.appToken),
    describeAccount: (account: OpeniLinkConfig) => ({
      status: account.hubUrl ? "configured" : "unconfigured",
      label: account.hubUrl || "Not configured",
    }),
  },

  gateway: {
    startAccount,
    stopAccount,
  },

  outbound: createOutboundAdapter(resolveConfig),
};
