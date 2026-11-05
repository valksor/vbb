import type { ReactNode } from "react";
import { PluginSlotMount } from "./PluginSlotMount";

export function PluginPerThreadSlotMount({
  slot,
  slotKind,
  instanceId,
  children,
}: {
  slot: { pluginId: string; id: string; generation: number };
  slotKind: string;
  instanceId: string;
  children: ReactNode;
}) {
  return (
    <PluginSlotMount
      pluginId={slot.pluginId}
      slotKind={slotKind}
      slotId={slot.id}
      instanceId={instanceId}
      crashFallback={null}
    >
      {children}
    </PluginSlotMount>
  );
}
