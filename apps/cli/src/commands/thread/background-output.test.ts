import { describe, expect, it } from "vitest";
import { sanitizeBackgroundOutput } from "./background-output.js";

const ESC = "\u001b";
const BEL = "\u0007";

describe("sanitizeBackgroundOutput", () => {
  it.each([
    [
      "plain text is untouched",
      "line 1\nline 2\ttabbed\n",
      "line 1\nline 2\ttabbed\n",
    ],
    [
      "SGR colour sequences are kept",
      `${ESC}[1;31mfail${ESC}[0m ok`,
      `${ESC}[1;31mfail${ESC}[0m ok`,
    ],
    [
      "OSC 8 hyperlinks are removed, keeping the label",
      `${ESC}]8;;https://example.com${ESC}\\label${ESC}]8;;${ESC}\\`,
      "label",
    ],
    [
      "OSC 52 clipboard writes are removed (BEL terminated)",
      `before${ESC}]52;c;ZXZpbA==${BEL}after`,
      "beforeafter",
    ],
    [
      "OSC window title changes are removed",
      `${ESC}]0;title${BEL}text`,
      "text",
    ],
    [
      "unterminated OSC drops the rest of the chunk",
      `ok${ESC}]52;c;ZXZpbA==`,
      "ok",
    ],
    [
      "cursor movement and erase sequences are removed",
      `a${ESC}[2K${ESC}[1A${ESC}[10;5Hb${ESC}[?25lc`,
      "abc",
    ],
    [
      "non-SGR CSI that ends in m-like intermediates is removed",
      `a${ESC}[1 mb`,
      "ab",
    ],
    ["DCS strings are removed", `a${ESC}Pq#0;2;0;0;0${ESC}\\b`, "ab"],
    ["charset selection is removed", `a${ESC}(Bb`, "ab"],
    ["a trailing bare ESC is removed", `abc${ESC}`, "abc"],
    [
      "a bare ESC followed by a character outside the printable range is removed",
      `a${ESC}\nb${ESC}\u0001c`,
      "a\nbc",
    ],
    ["CRLF becomes LF", "one\r\ntwo\r\n", "one\ntwo\n"],
    [
      "carriage-return overwrites keep the last segment per line",
      "10%\r50%\r100%\ndone",
      "100%\ndone",
    ],
    [
      "a trailing carriage return keeps the visible text",
      "spinner\r",
      "spinner",
    ],
    [
      "other control characters and C1 controls are removed",
      "a\u0000b\u0008c\u007fd\u009be",
      "abcde",
    ],
  ])("%s", (_name, input, expected) => {
    expect(sanitizeBackgroundOutput(input)).toBe(expected);
  });
});
