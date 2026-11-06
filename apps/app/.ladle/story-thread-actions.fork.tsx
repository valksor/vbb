import type { ComponentProps } from "react";
import { ThreadActionsProvider } from "@/components/thread/ThreadActionsProvider";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";

type StoryThreadActionsProviderProps = ComponentProps<
  typeof SidebarThreadEntriesProvider
>;

export function StoryThreadActionsProvider({
  children,
  navigation,
}: StoryThreadActionsProviderProps) {
  return (
    <SidebarThreadEntriesProvider navigation={navigation}>
      <ThreadActionsProvider>{children}</ThreadActionsProvider>
    </SidebarThreadEntriesProvider>
  );
}
