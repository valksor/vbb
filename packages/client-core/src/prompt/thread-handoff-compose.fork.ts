import {
  permissionModeSchema,
  promptTextMentionSchema,
  reasoningLevelSchema,
  serviceTierSchema,
  type PermissionMode,
  type ReasoningLevel,
  type ServiceTier,
} from "@bb/domain";
import { uploadedPromptAttachmentSchema } from "@bb/server-contract";
import { z } from "zod";
import { isPromptDraftEmpty, type PromptDraftState } from "./prompt-draft.js";
import {
  buildThreadHandoffFollowUpDraft,
  stripThreadHandoffPrefix,
  type ThreadHandoffCreateSeed,
} from "./thread-handoff-request.js";

export const THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY =
  "threadHandoffComposeSeed";

const THREAD_HANDOFF_FOLLOW_UP_SEPARATOR = "\n\n";

function joinPromptDrafts(
  head: PromptDraftState,
  tail: PromptDraftState,
): PromptDraftState {
  const offset = head.text.length + THREAD_HANDOFF_FOLLOW_UP_SEPARATOR.length;
  return {
    text: `${head.text}${THREAD_HANDOFF_FOLLOW_UP_SEPARATOR}${tail.text}`,
    mentions: [
      ...head.mentions,
      ...tail.mentions.map((mention) => ({
        ...mention,
        start: mention.start + offset,
        end: mention.end + offset,
      })),
    ],
    attachments: [...head.attachments, ...tail.attachments],
  };
}

export function buildThreadHandoffFollowUpDraftWithOwnAttachments(
  seed: ThreadHandoffCreateSeed,
  draft: PromptDraftState,
): PromptDraftState {
  const followUp = buildThreadHandoffFollowUpDraft(seed, draft);
  if (followUp === draft) return draft;
  return { ...followUp, attachments: [...followUp.attachments] };
}

function promptDraftStartsWith(
  draft: PromptDraftState,
  head: PromptDraftState,
): boolean {
  return (
    draft.text.startsWith(head.text) &&
    head.mentions.every((headMention) =>
      draft.mentions.some(
        (mention) => JSON.stringify(mention) === JSON.stringify(headMention),
      ),
    )
  );
}

export function mergeThreadHandoffComposeDraft(
  seed: ThreadHandoffCreateSeed,
  handoffDraft: PromptDraftState,
  existingDraft: PromptDraftState,
): PromptDraftState {
  if (promptDraftStartsWith(existingDraft, handoffDraft)) return existingDraft;
  const existingBody =
    stripThreadHandoffPrefix(seed, existingDraft) ?? existingDraft;
  return isPromptDraftEmpty(existingBody)
    ? handoffDraft
    : joinPromptDrafts(handoffDraft, existingBody);
}

export interface ThreadHandoffComposeSeed {
  draft: PromptDraftState;
  environmentId: string | null;
  model: string;
  permissionMode: PermissionMode;
  projectId: string;
  providerId: string;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  sourceThreadId: string;
  sourceThreadTitle: string;
}

const nonEmptyStringSchema = z.string().min(1);

const threadHandoffComposeSeedSchema = z.object({
  draft: z.object({
    text: nonEmptyStringSchema,
    mentions: z.array(promptTextMentionSchema),
    attachments: z.array(uploadedPromptAttachmentSchema),
  }),
  environmentId: nonEmptyStringSchema.nullable(),
  model: nonEmptyStringSchema,
  permissionMode: permissionModeSchema,
  projectId: nonEmptyStringSchema,
  providerId: nonEmptyStringSchema,
  reasoningLevel: reasoningLevelSchema,
  serviceTier: serviceTierSchema.optional(),
  sourceThreadId: nonEmptyStringSchema,
  sourceThreadTitle: z.string().trim().min(1),
});

export function readThreadHandoffComposeSeedFromLocationState(
  state: unknown,
): ThreadHandoffComposeSeed | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY
  ];
  const result = threadHandoffComposeSeedSchema.safeParse(candidate);
  if (!result.success) return null;
  const { serviceTier, ...seed } = result.data;
  return { ...seed, serviceTier };
}
