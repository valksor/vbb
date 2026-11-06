import { describe, expect, expectTypeOf, it } from "vitest";
import { probeClaudeInitialization } from "./initialization-probe.js";

type ProbeArgs = Parameters<typeof probeClaudeInitialization>[0];

describe("probeClaudeInitialization settings file", () => {
  it("makes every caller choose a settings file or null", () => {
    expectTypeOf<ProbeArgs["settingsFile"]>().toEqualTypeOf<string | null>();
    expect(true).toBe(true);
  });
});
