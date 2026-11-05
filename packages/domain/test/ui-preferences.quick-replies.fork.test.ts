import { describe, expect, it } from "vitest";
import {
  COMPOSER_QUICK_REPLIES_MAX_COUNT,
  UI_PREFERENCE_STRING_MAX_LENGTH,
  getUiPreferenceDefault,
  parseUiPreferenceValue,
} from "../src/ui-preferences.js";

describe("composer.quickReplies", () => {
  it("defaults to an empty list and accepts ordered duplicates and multiline messages", () => {
    expect(getUiPreferenceDefault("composer.quickReplies")).toEqual([]);
    expect(
      parseUiPreferenceValue("composer.quickReplies", [
        " a ",
        "a",
        "line one\nline two",
      ]),
    ).toEqual({ success: true, value: ["a", "a", "line one\nline two"] });
  });

  it("accepts its maximum valid bounds", () => {
    expect(
      parseUiPreferenceValue(
        "composer.quickReplies",
        Array.from({ length: COMPOSER_QUICK_REPLIES_MAX_COUNT }, () =>
          "x".repeat(UI_PREFERENCE_STRING_MAX_LENGTH),
        ),
      ).success,
    ).toBe(true);
  });

  it.each([
    null,
    "continue",
    [""],
    ["  "],
    Array.from({ length: COMPOSER_QUICK_REPLIES_MAX_COUNT + 1 }, () => "x"),
    ["x".repeat(UI_PREFERENCE_STRING_MAX_LENGTH + 1)],
  ])("rejects invalid values", (value) => {
    expect(parseUiPreferenceValue("composer.quickReplies", value).success).toBe(
      false,
    );
  });
});
