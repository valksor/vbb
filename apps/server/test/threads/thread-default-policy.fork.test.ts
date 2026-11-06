import { describe, expect, it } from "vitest";
import { resolveCreateThreadWorktreePromotion } from "../../src/services/threads/thread-default-policy.fork.js";

describe("resolveCreateThreadWorktreePromotion", () => {
  const checkoutPlacement = {
    type: "provider",
    environmentProviderId: "project-checkout",
    machine: { type: "existing", hostId: "host-1" },
    inputs: { path: "/tmp/project" },
  } as const;

  it("arms promotion for an implicit project-default checkout placement", () => {
    expect(
      resolveCreateThreadWorktreePromotion({
        requestedEnvironment: { type: "project-default" },
        resolvedEnvironment: checkoutPlacement,
      }),
    ).toBe("armed");
  });

  it("arms explicit branch promotion only for a checkout", () => {
    expect(
      resolveCreateThreadWorktreePromotion({
        requestedEnvironment: { type: "project-default", promotion: "branch" },
        resolvedEnvironment: checkoutPlacement,
      }),
    ).toBe("armed");
    expect(() =>
      resolveCreateThreadWorktreePromotion({
        requestedEnvironment: { type: "project-default", promotion: "branch" },
        resolvedEnvironment: {
          type: "provider",
          environmentProviderId: "personal-workspace",
          machine: { type: "existing", hostId: "host-1" },
          inputs: null,
        },
      }),
    ).toThrow(/requires an available project checkout/);
  });

  it("declines when the caller named the project-checkout provider", () => {
    expect(
      resolveCreateThreadWorktreePromotion({
        requestedEnvironment: checkoutPlacement,
        resolvedEnvironment: checkoutPlacement,
      }),
    ).toBe("declined");
  });

  it("declines when the default resolves somewhere other than the checkout", () => {
    expect(
      resolveCreateThreadWorktreePromotion({
        requestedEnvironment: { type: "project-default" },
        resolvedEnvironment: {
          type: "provider",
          environmentProviderId: "personal-workspace",
          machine: { type: "existing", hostId: "host-1" },
          inputs: null,
        },
      }),
    ).toBe("declined");
  });
});
