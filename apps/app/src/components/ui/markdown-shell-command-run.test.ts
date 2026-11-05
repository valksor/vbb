import { OPEN_IN_TARGET_COMMAND_MAX_LENGTH } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import {
  isRunnableShellCodeBlock,
  isRunnableShellCodeLanguage,
  stripBidiControlCharacters,
} from "./markdown-shell-command-run";

describe("isRunnableShellCodeLanguage", () => {
  it.each(["bash", "sh", "shell", "zsh"] as const)(
    "accepts the allowlisted %s tag",
    (language) => {
      expect(isRunnableShellCodeLanguage(language)).toBe(true);
    },
  );

  it.each([
    "json",
    "console",
    "ansi",
    "output",
    "fish",
    "BASH",
    "bash ",
    "mermaid",
    "",
  ])("rejects the non-allowlisted tag %s", (language) => {
    expect(isRunnableShellCodeLanguage(language)).toBe(false);
  });

  it("rejects a null language", () => {
    expect(isRunnableShellCodeLanguage(null)).toBe(false);
  });
});

describe("isRunnableShellCodeBlock", () => {
  it("accepts a plain command", () => {
    expect(isRunnableShellCodeBlock({ code: "npm test" })).toBe(true);
  });

  it("accepts a multi-line block that mixes comments and commands", () => {
    expect(
      isRunnableShellCodeBlock({
        code: "# install\nnpm install\n\nnpm test",
      }),
    ).toBe(true);
  });

  it("rejects an empty-after-trim block", () => {
    expect(isRunnableShellCodeBlock({ code: "   \n  \n" })).toBe(false);
    expect(isRunnableShellCodeBlock({ code: "" })).toBe(false);
  });

  it("rejects a comment-only block", () => {
    expect(
      isRunnableShellCodeBlock({ code: "# just a note\n   # another\n" }),
    ).toBe(false);
  });

  it("rejects a block over the shared command max length", () => {
    const withinCap = "echo ".repeat(
      Math.ceil((OPEN_IN_TARGET_COMMAND_MAX_LENGTH + 1) / 5),
    );
    expect(withinCap.length).toBeGreaterThan(OPEN_IN_TARGET_COMMAND_MAX_LENGTH);
    expect(isRunnableShellCodeBlock({ code: withinCap })).toBe(false);
    expect(
      isRunnableShellCodeBlock({
        code: `echo ${"a".repeat(OPEN_IN_TARGET_COMMAND_MAX_LENGTH - 6)}`,
      }),
    ).toBe(true);
  });

  it("rejects a block whose raw length exceeds the cap while trimmed is under", () => {
    const trimmedUnderCap = `echo ${"a".repeat(
      OPEN_IN_TARGET_COMMAND_MAX_LENGTH - 6,
    )}`;
    expect(trimmedUnderCap.length).toBeLessThan(
      OPEN_IN_TARGET_COMMAND_MAX_LENGTH,
    );
    expect(
      isRunnableShellCodeBlock({ code: `${trimmedUnderCap}\n\n\n\n\n` }),
    ).toBe(false);
  });

  it("rejects a block containing a character the daemon schema rejects", () => {
    expect(isRunnableShellCodeBlock({ code: "echo a​b" })).toBe(false);
    expect(isRunnableShellCodeBlock({ code: "echo a‎b" })).toBe(false);
    expect(isRunnableShellCodeBlock({ code: "echo a\u0001b" })).toBe(false);
  });
});

describe("stripBidiControlCharacters", () => {
  it("strips the bidi control characters pinned by the request schema", () => {
    expect(
      stripBidiControlCharacters(
        "a‪b‬c‮d‫e⁦f⁩g⁨h⁧i؜j",
      ),
    ).toBe("abcdefghij");
  });

  it("strips the shared invisible and reordering characters", () => {
    expect(
      stripBidiControlCharacters(
        "a‎b‏c​d⁠e⁡f⁢g⁣h⁤i﻿j‪k‫l‬m‭n⁦o⁧p⁨q⁩r؜s",
      ),
    ).toBe("abcdefghijklmnopqrs");
  });

  it("keeps zero-width joiner, zero-width non-joiner, and soft hyphen", () => {
    const text = "a‍b‌c­d";
    expect(stripBidiControlCharacters(text)).toBe(text);
  });

  it("leaves text without bidi controls unchanged", () => {
    expect(stripBidiControlCharacters("rm -rf /tmp/x\nls -la")).toBe(
      "rm -rf /tmp/x\nls -la",
    );
  });
});
