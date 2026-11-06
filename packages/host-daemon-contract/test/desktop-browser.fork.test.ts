import { describe, expect, it } from "vitest";
import {
  desktopBrowserCommandSchema,
  desktopBrowserLeaseSchema,
} from "../src/desktop-browser.js";

const scope = {
  instanceId: "window",
  generation: "generation",
  threadId: "thread",
};

describe("fork desktop browser command boundaries", () => {
  it("accepts 256 Unicode code points in controller labels", () => {
    const controllerLabel = String.fromCodePoint(0x1f680).repeat(256);
    const command = {
      type: "desktop.browser.acquire_control" as const,
      ...scope,
      leaseId: "lease",
      tabIds: ["tab"],
      controllerLabel,
      expiresAt: 1,
    };
    const lease = {
      leaseId: "lease",
      controllerLabel,
      expiresAt: 1,
    };
    const commandResult = desktopBrowserCommandSchema.safeParse(command);
    expect(commandResult.success).toBe(true);
    if (
      commandResult.success &&
      commandResult.data.type === "desktop.browser.acquire_control"
    ) {
      expect(commandResult.data.controllerLabel).toBe(controllerLabel);
    }
    expect(desktopBrowserLeaseSchema.parse(lease)).toEqual(lease);

    for (const invalidControllerLabel of [
      String.fromCodePoint(0x1f680).repeat(257),
      "",
    ]) {
      expect(
        desktopBrowserCommandSchema.safeParse({
          ...command,
          controllerLabel: invalidControllerLabel,
        }).success,
      ).toBe(false);
      expect(
        desktopBrowserLeaseSchema.safeParse({
          ...lease,
          controllerLabel: invalidControllerLabel,
        }).success,
      ).toBe(false);
    }
  });
});
