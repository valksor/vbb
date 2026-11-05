import type { PromptDraftState } from "@bb/client-core";
import {
  getPromptDraftAccessor,
  type PromptDraftController,
  type PromptDraftScope,
} from "@/hooks/usePromptDraftStorage";

export type CarryDraftToProject = (
  draft: PromptDraftState,
  targetDraft: PromptDraftState,
) => PromptDraftState;

export function skipsDraftCarry(
  draftStorageKind: PromptDraftScope["kind"],
  carryDraftToProject: CarryDraftToProject | undefined,
): boolean {
  return draftStorageKind === "new-thread" && carryDraftToProject === undefined;
}

export function carryNewThreadDraft({
  carryDraftToProject,
  draftStorageKind,
  nextValue,
  promptDraft,
}: {
  carryDraftToProject: CarryDraftToProject | undefined;
  draftStorageKind: PromptDraftScope["kind"];
  nextValue: string;
  promptDraft: PromptDraftController;
}): boolean {
  if (draftStorageKind !== "new-thread" || !carryDraftToProject) return false;
  const targetDraft = getPromptDraftAccessor({
    kind: "new-thread",
    projectId: nextValue,
  });
  targetDraft.setDraft(
    carryDraftToProject(promptDraft.getCurrent(), targetDraft.getCurrent()),
  );
  promptDraft.clear();
  return true;
}
