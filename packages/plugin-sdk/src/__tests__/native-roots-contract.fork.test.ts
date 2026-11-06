import { describe, expect, it } from "vitest";
import { experimental_nativeRootsResolveInputSchema } from "../native-roots-contract.js";

describe("experimental_nativeRootsResolveInputSchema", () => {
  it("accepts omitted and registered bridge options", () => {
    expect(
      experimental_nativeRootsResolveInputSchema.parse({
        providerId: "claude-code",
        cwd: null,
      }),
    ).not.toHaveProperty("bridgeOptions");
    expect(
      experimental_nativeRootsResolveInputSchema.parse({
        providerId: "claude-code-work",
        cwd: "/workspace",
        bridgeOptions: { claudeConfigDir: "/profiles/work" },
      }),
    ).toMatchObject({ bridgeOptions: { claudeConfigDir: "/profiles/work" } });
  });
});
