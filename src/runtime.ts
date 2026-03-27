import type { PluginRuntime } from "openclaw/plugin-sdk/core";

let runtime: PluginRuntime;

export function setPluginRuntime(rt: PluginRuntime) {
  runtime = rt;
}

export function getPluginRuntime(): PluginRuntime {
  return runtime;
}
