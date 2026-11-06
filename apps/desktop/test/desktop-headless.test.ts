import { describe, expect, it } from "vitest";
import { isDesktopHeadless } from "../src/desktop-headless.js";

describe("isDesktopHeadless", () => {
  it("is active when the env var is set in an unpackaged build", () => {
    expect(
      isDesktopHeadless({
        env: { BB_DESKTOP_HEADLESS: "1" },
        isPackaged: false,
      }),
    ).toBe(true);
  });

  it.each([undefined, "", "0", "true", "on"])(
    "stays inactive for the env value %s",
    (value) => {
      expect(
        isDesktopHeadless({
          env: { BB_DESKTOP_HEADLESS: value },
          isPackaged: false,
        }),
      ).toBe(false);
    },
  );

  it("stays inactive in a packaged build even with the env var set", () => {
    expect(
      isDesktopHeadless({
        env: { BB_DESKTOP_HEADLESS: "1" },
        isPackaged: true,
      }),
    ).toBe(false);
  });
});
