import { uiPreferenceDefinitions } from "@bb/domain";
import { createLastKnownCache } from "@/lib/last-known-cache";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";

const lastKnownQuickRepliesCache = createLastKnownCache({
  prefix: "bb.composer-quick-replies",
  version: "1",
  schema: uiPreferenceDefinitions["composer.quickReplies"].schema,
});
const LAST_KNOWN_QUICK_REPLIES_KEY = lastKnownQuickRepliesCache.key();

export const quickRepliesAtom = createSyncedPreferenceAtom(
  "composer.quickReplies",
  {
    read: () => lastKnownQuickRepliesCache.read(LAST_KNOWN_QUICK_REPLIES_KEY),
    write: (value) =>
      lastKnownQuickRepliesCache.write(LAST_KNOWN_QUICK_REPLIES_KEY, value),
  },
);
