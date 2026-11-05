import { setPluginSlotRegistrations } from "@/lib/plugin-slots";
import { makePluginRegistrationSet } from "./plugins";
import type { PluginRegistrationSet } from "@/lib/plugin-slots";

export function registerPluginSlotsForTest(
  pluginId: string,
  overrides: Partial<PluginRegistrationSet> = {},
): void {
  setPluginSlotRegistrations(pluginId, makePluginRegistrationSet(overrides));
}
