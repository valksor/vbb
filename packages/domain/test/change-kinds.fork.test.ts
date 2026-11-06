import { describe, expect, it } from "vitest";
import { changedMessageLenientSchema } from "../src/change-kinds.js";

describe("lenient changed-message schema parity", () => {
  it("degrades an unknown pending interaction kind to the generic glyph", () => {
    const parsed = changedMessageLenientSchema.parse({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: {
        hasPendingInteraction: true,
        pendingInteractionKind: "brand_new_kind",
      },
      changes: ["interactions-changed"],
    });
    expect(parsed).toEqual({
      type: "changed",
      entity: "thread",
      id: "thr_1",
      metadata: {
        hasPendingInteraction: true,
        pendingInteractionKind: null,
      },
      changes: ["interactions-changed"],
    });
  });
});
