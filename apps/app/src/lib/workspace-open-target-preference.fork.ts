import { atomWithStorage } from "jotai/utils";
import { useAtom } from "jotai";
import {
  workspaceOpenTargetPreferenceStorage,
  type StoredWorkspaceOpenTargetPreference,
} from "./workspace-open-target-preference";

export const TERMINAL_RUN_TARGET_STORAGE_KEY = "bb.terminalRunTarget";

export const terminalRunTargetPreferenceAtom =
  atomWithStorage<StoredWorkspaceOpenTargetPreference>(
    TERMINAL_RUN_TARGET_STORAGE_KEY,
    null,
    workspaceOpenTargetPreferenceStorage,
    { getOnInit: true },
  );

export function useTerminalRunTargetPreference() {
  const [preferredTargetId, setPreferredTargetId] = useAtom(
    terminalRunTargetPreferenceAtom,
  );
  return [preferredTargetId, setPreferredTargetId] as const;
}
