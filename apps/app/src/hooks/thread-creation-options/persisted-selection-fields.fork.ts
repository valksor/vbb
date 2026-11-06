import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { createTabScopedStorage } from "@/lib/browser-storage";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";

export const PROVIDER_STORAGE_KEY = "bb.promptbox.provider";

type StringSelectionStorage = ReturnType<typeof createTabScopedStorage<string>>;

let projectProviderIdAtomFamily: ReturnType<
  typeof createProjectProviderIdAtomFamily
> | null = null;

export function createProjectProviderIdAtomFamily(
  storage: StringSelectionStorage,
) {
  const family = atomFamily((projectId: string) =>
    atomWithStorage<string>(
      getProjectScopedStorageKey(PROVIDER_STORAGE_KEY, projectId),
      "",
      storage,
      { getOnInit: true },
    ),
  );
  projectProviderIdAtomFamily = family;
  return family;
}

export function resetProjectProviderPreferencesForTests(): void {
  projectProviderIdAtomFamily?.setShouldRemove(() => true);
  projectProviderIdAtomFamily?.setShouldRemove(null);
}
