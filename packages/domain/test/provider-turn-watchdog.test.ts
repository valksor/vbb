import { describe, expect, it } from "vitest";
import { systemProviderTurnWatchdogEventDataSchema } from "../src/index.js";

describe("provider turn watchdog activity event types", () => {
  it("decodes legacy watchdog diagnostics as notifications and rejects invalid actions", () => {
    const event = {
      activeTurnId: "turn-1",
      activeTurnStartedAt: 1_000,
      elapsedMs: 2_000,
      firedAt: 3_000,
      lastActivityEventAt: 2_000,
      lastActivityEventSequence: 4,
      lastActivityEventType: "item/agentMessage/delta",
      providerId: "codex",
      providerThreadId: "provider-thread-1",
      reason: "provider-turn-idle",
      thresholdMs: 2_000,
    };

    expect(
      systemProviderTurnWatchdogEventDataSchema.parse(event),
    ).toMatchObject({
      action: "notify",
    });
    expect(
      systemProviderTurnWatchdogEventDataSchema.safeParse({
        ...event,
        action: "pause",
      }).success,
    ).toBe(false);
  });
});
