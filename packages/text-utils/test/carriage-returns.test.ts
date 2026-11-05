import { describe, expect, it } from "vitest";
import { collapseCarriageReturns } from "../src/carriage-returns.js";

describe("collapseCarriageReturns", () => {
  it.each([
    ["plain lines are untouched", "a\nb\n", "a\nb\n"],
    ["CRLF line endings become LF", "a\r\nb\r\n", "a\nb\n"],
    [
      "overwritten segments keep the last one per line",
      "1%\r50%\r100%\nok",
      "100%\nok",
    ],
    ["a trailing carriage return keeps the visible text", "spin\r", "spin"],
    ["lines are collapsed independently", "a\rb\nc\rd", "b\nd"],
  ])("%s", (_name, input, expected) => {
    expect(collapseCarriageReturns(input)).toBe(expected);
  });
});
