import { describe, expect, it } from "vitest";
import {
  buildThreadHandoffFollowUpDraftWithOwnAttachments,
  mergeThreadHandoffComposeDraft,
  readThreadHandoffComposeSeedFromLocationState,
  THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY,
  type ThreadHandoffComposeSeed,
} from "../src/prompt/thread-handoff-compose.fork.js";
import type { PromptDraftAttachment } from "../src/prompt/prompt-draft.js";
import type { ThreadHandoffCreateSeed } from "../src/prompt/thread-handoff-request.js";

const SEED: ThreadHandoffCreateSeed = {
  environmentId: "env_source",
  projectId: "proj_source",
  sourceThreadId: "thr_source",
  sourceThreadTitle: "Source thread",
};

const SOURCE_MENTION = {
  start: 14,
  end: 32,
  resource: {
    kind: "thread" as const,
    projectId: "proj_source",
    threadId: "thr_source",
    label: "Source thread",
  },
};

describe("readThreadHandoffComposeSeedFromLocationState", () => {
  const COMPOSE_SEED: ThreadHandoffComposeSeed = {
    draft: {
      text: "Continue from @thread:thr_source",
      mentions: [SOURCE_MENTION],
      attachments: [],
    },
    environmentId: "env_source",
    model: "claude-opus-5",
    permissionMode: "auto",
    projectId: "proj_source",
    providerId: "claude-code",
    reasoningLevel: "high",
    serviceTier: "fast",
    sourceThreadId: "thr_source",
    sourceThreadTitle: "Source thread",
  };
  const stateWith = (seed: unknown) => ({
    focusPrompt: true,
    [THREAD_HANDOFF_COMPOSE_SEED_LOCATION_STATE_KEY]: seed,
  });

  it("round-trips a seed carried through location state", () => {
    expect(
      readThreadHandoffComposeSeedFromLocationState(stateWith(COMPOSE_SEED)),
    ).toEqual(COMPOSE_SEED);
  });

  it("accepts a source thread without an environment or service tier", () => {
    const { serviceTier: _serviceTier, ...withoutTier } = COMPOSE_SEED;
    expect(
      readThreadHandoffComposeSeedFromLocationState(
        stateWith({ ...withoutTier, environmentId: null }),
      ),
    ).toEqual({ ...COMPOSE_SEED, environmentId: null, serviceTier: undefined });
  });

  it.each([
    ["missing state", null],
    ["no seed", { focusPrompt: true }],
    ["an empty draft", stateWith({ ...COMPOSE_SEED, draft: { text: "", mentions: [], attachments: [] } })],
    ["an empty model", stateWith({ ...COMPOSE_SEED, model: "" })],
    ["an unknown permission mode", stateWith({ ...COMPOSE_SEED, permissionMode: "yolo" })],
    ["a blank source title", stateWith({ ...COMPOSE_SEED, sourceThreadTitle: "  " })],
    ["a malformed mention", stateWith({ ...COMPOSE_SEED, draft: { ...COMPOSE_SEED.draft, mentions: [{ start: 0 }] } })],
  ])("rejects %s", (_label, state) => {
    expect(readThreadHandoffComposeSeedFromLocationState(state)).toBeNull();
  });
});

describe("mergeThreadHandoffComposeDraft", () => {
  const handoffDraft = {
    text: "Continue from @thread:thr_source",
    mentions: [SOURCE_MENTION],
    attachments: [],
  };

  it("uses the handoff draft when the composer draft is empty", () => {
    expect(mergeThreadHandoffComposeDraft(SEED, handoffDraft, { text: "", mentions: [], attachments: [] })).toBe(handoffDraft);
  });

  it("keeps an unsent composer draft after the handoff, re-anchoring its mentions", () => {
    const existingMention = { start: 4, end: 21, resource: { kind: "thread" as const, projectId: "proj_other", threadId: "thr_other", label: "Other" } };
    const merged = mergeThreadHandoffComposeDraft(SEED, handoffDraft, { text: "See @thread:thr_other", mentions: [existingMention], attachments: [] });
    expect(merged.text).toBe("Continue from @thread:thr_source\n\nSee @thread:thr_other");
    const offset = handoffDraft.text.length + 2;
    expect(merged.mentions).toEqual([SOURCE_MENTION, { ...existingMention, start: 4 + offset, end: 21 + offset }]);
    const shifted = merged.mentions[1]!;
    expect(merged.text.slice(shifted.start, shifted.end)).toBe("@thread:thr_other");
  });

  it("does not prepend the handoff twice when the seed is applied again", () => {
    const seededDraft = { text: "Continue from @thread:thr_source\n\nKeep going", mentions: [SOURCE_MENTION], attachments: [] };
    const once = mergeThreadHandoffComposeDraft(SEED, seededDraft, { text: "Stale draft", mentions: [], attachments: [] });
    const twice = mergeThreadHandoffComposeDraft(SEED, seededDraft, once);
    expect(twice).toBe(once);
    expect(twice.text).toBe("Continue from @thread:thr_source\n\nKeep going\n\nStale draft");
    expect(mergeThreadHandoffComposeDraft(SEED, seededDraft, seededDraft)).toBe(seededDraft);
  });

  it("replaces a stale handoff prefix for the same source thread", () => {
    const merged = mergeThreadHandoffComposeDraft(SEED, { text: "Continue from @thread:thr_source\n\nnew", mentions: [SOURCE_MENTION], attachments: [] }, { text: "Continue from @thread:thr_source\n\nold", mentions: [SOURCE_MENTION], attachments: [] });
    expect(merged.text).toBe("Continue from @thread:thr_source\n\nnew\n\nold");
    expect(merged.mentions).toEqual([SOURCE_MENTION]);
  });
});

describe("buildThreadHandoffFollowUpDraftWithOwnAttachments", () => {
  const ATTACHMENT: PromptDraftAttachment = { type: "localImage", path: "/tmp/shot.png", name: "shot.png", mimeType: "image/png", sizeBytes: 12 };

  it("returns a copy of the attachments array rather than the input array", () => {
    const attachments = [ATTACHMENT];
    const draft = buildThreadHandoffFollowUpDraftWithOwnAttachments(SEED, { text: "Keep going", mentions: [], attachments });
    expect(draft.text).toBe("Continue from @thread:thr_source\n\nKeep going");
    expect(draft.attachments).toEqual(attachments);
    expect(draft.attachments).not.toBe(attachments);
  });

  it("leaves a draft alone when it already starts with the source reference", () => {
    const draft = { text: "Continue from @thread:thr_source\n\nKeep going", mentions: [SOURCE_MENTION], attachments: [ATTACHMENT] };
    expect(buildThreadHandoffFollowUpDraftWithOwnAttachments(SEED, draft)).toBe(draft);
  });
});
