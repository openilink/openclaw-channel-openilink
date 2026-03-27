import type { OpeniLinkConfig } from "./types.js";

export function resolveConfig(cfg: any, accountId?: string | null): OpeniLinkConfig {
  const channelCfg = cfg?.channels?.openilink;
  if (!channelCfg || typeof channelCfg !== "object") {
    return { hubUrl: "", appToken: "" };
  }

  // Support multi-account
  if (accountId && channelCfg.accounts?.[accountId]) {
    const account = channelCfg.accounts[accountId];
    return {
      hubUrl: String(account.hub_url || channelCfg.hub_url || "").replace(/\/$/, ""),
      appToken: String(account.app_token || channelCfg.app_token || ""),
    };
  }

  return {
    hubUrl: String(channelCfg.hub_url || "").replace(/\/$/, ""),
    appToken: String(channelCfg.app_token || ""),
  };
}

export function listAccountIds(cfg: any): string[] {
  const channelCfg = cfg?.channels?.openilink || {};
  if (channelCfg.accounts && typeof channelCfg.accounts === "object" && !Array.isArray(channelCfg.accounts)) {
    return Object.keys(channelCfg.accounts);
  }
  // Single account mode — return default ID
  if (channelCfg.hub_url && channelCfg.app_token) {
    return ["default"];
  }
  return [];
}

export function isConfigured(cfg: any, accountId?: string | null): boolean {
  const resolved = resolveConfig(cfg, accountId);
  return !!(resolved.hubUrl && resolved.appToken);
}
