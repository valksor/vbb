import { describe, expect, it } from "vitest";
import { hostDaemonCommandSchema } from "../src/index.js";

describe("host-daemon command schemas", () => {
  it("round-trips lease-scoped work barrier commands", () => {
    expect(
      hostDaemonCommandSchema.parse({
        type: "work.quiesce",
        operationId: "update-1",
        expiresAt: 1_700_000_060_000,
      }),
    ).toEqual({
      type: "work.quiesce",
      operationId: "update-1",
      expiresAt: 1_700_000_060_000,
    });
    expect(
      hostDaemonCommandSchema.parse({
        type: "work.seal",
        operationId: "update-1",
      }),
    ).toEqual({ type: "work.seal", operationId: "update-1" });
    expect(
      hostDaemonCommandSchema.parse({
        type: "work.unquiesce",
        operationId: "update-1",
      }),
    ).toEqual({ type: "work.unquiesce", operationId: "update-1" });
  });
});
