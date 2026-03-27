import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime | undefined;

export function setPluginRuntime(rt: PluginRuntime) {
  runtime = rt;
}

export function getPluginRuntime(): PluginRuntime | undefined {
  return runtime;
}
