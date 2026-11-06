import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import {
  createTabScopedStorage,
  withLocalStorage,
} from "@/lib/browser-storage";
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

function getLegacyProviderSelection(
  providerId: string,
  storageKey: string,
): string | null {
  return withLocalStorage((storage) => {
    if (storage.getItem(PROVIDER_STORAGE_KEY) !== providerId) return null;
    return storage.getItem(storageKey);
  }, null);
}

export function createProviderSelectionStorage<Value extends string>(
  providerId: string,
  storageKey: string,
  parse: (value: string | null, initialValue: Value) => Value,
) {
  return createTabScopedStorage<Value>(
    {
      parse: (storedValue, initialValue) =>
        parse(
          storedValue ?? getLegacyProviderSelection(providerId, storageKey),
          initialValue,
        ),
      serialize: (value) => value,
    },
    { persistInitialValue: true },
  );
}
