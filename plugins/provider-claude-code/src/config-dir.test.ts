import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  claudeConfigDirKeychainService,
  claudeConfigDirLoginCommand,
  parseClaudeConfigDir,
  validateProfilePathForm,
} from "./config-dir.js";
import { claudeCodeProviderDeclaration } from "./declaration.js";

const HOME = "/Users/example";

describe("parseClaudeConfigDir", () => {
  it("expands ~/ against the home directory", () => {
    expect(parseClaudeConfigDir("~/.claude-work", HOME)).toBe(
      "/Users/example/.claude-work",
    );
  });

  it("returns canonical absolute input unchanged", () => {
    expect(parseClaudeConfigDir("/srv/claude/profile", HOME)).toBe(
      "/srv/claude/profile",
    );
  });

  it("rejects non-canonical input before resolving it", () => {
    expect(() => parseClaudeConfigDir("/srv/claude/", HOME)).toThrow(
      /trailing/u,
    );
  });

  it("makes the shell $HOME form of ~/ resolve to the parsed path", () => {
    const hint = claudeCodeProviderDeclaration({
      id: "work",
      displayName: "Claude Work",
      configDir: "~/.claude-work",
    }).strings?.signInHint;
    expect(hint).toContain('CLAUDE_CONFIG_DIR="$HOME/.claude-work"');
    expect(parseClaudeConfigDir("~/.claude-work", HOME)).toBe(
      `${HOME}/.claude-work`,
    );
  });

  it.each(["relative/dir", "./dir", "~other/dir", ""])(
    "rejects non-absolute value %j",
    (value) => {
      expect(() => parseClaudeConfigDir(value, HOME)).toThrow(/absolute/u);
    },
  );

  it.each(["~/../etc", "/srv/../etc", "/srv/a/.."])(
    "rejects .. segment in %j",
    (value) => {
      expect(() => parseClaudeConfigDir(value, HOME)).toThrow(/\.\./u);
    },
  );

  it("allows names that merely contain dots", () => {
    expect(parseClaudeConfigDir("~/..claude", HOME)).toBe(
      "/Users/example/..claude",
    );
  });

  it.each(["~", "~/", "/Users/example"])(
    "rejects the home directory itself (%j)",
    (value) => {
      expect(() => parseClaudeConfigDir(value, HOME)).toThrow(/home/u);
    },
  );

  it.each(["$", "`", '"', "'", "\\", "!"])(
    "rejects the shell-active character %s and names it",
    (character) => {
      expect(() => parseClaudeConfigDir(`/srv/a${character}b`, HOME)).toThrow(
        `character ${character}`,
      );
    },
  );

  it("rejects $HOME spelled out", () => {
    expect(() => parseClaudeConfigDir("$HOME/.claude", HOME)).toThrow(
      "character $",
    );
  });
});

describe("validateProfilePathForm", () => {
  it.each(["~/.claude-work", "/srv/claude", "~/..claude"])(
    "accepts %j without knowing the home directory",
    (value) => {
      expect(() =>
        validateProfilePathForm(value, "claudeConfigDir"),
      ).not.toThrow();
    },
  );

  it.each(["~", "~/", "~/."])("rejects the home directory form %j", (value) => {
    expect(() => validateProfilePathForm(value, "claudeConfigDir")).toThrow(
      /home/u,
    );
  });

  it("names the rejected character", () => {
    expect(() => validateProfilePathForm("~/a`b", "claudeConfigDir")).toThrow(
      "character `",
    );
  });

  it("rejects the filesystem root with a dedicated message", () => {
    expect(() => validateProfilePathForm("/", "claudeConfigDir")).toThrow(
      /filesystem root/u,
    );
  });

  it.each(["/srv/claude/", "~/.claude-work/"])(
    "rejects the trailing slash in %j",
    (value) => {
      expect(() => validateProfilePathForm(value, "claudeConfigDir")).toThrow(
        /trailing/u,
      );
    },
  );

  it.each(["/srv//claude", "~/a//b"])(
    "rejects the empty segment in %j",
    (value) => {
      expect(() => validateProfilePathForm(value, "claudeConfigDir")).toThrow(
        /empty/u,
      );
    },
  );

  it.each(["/srv/./claude", "~/./a", "/srv/claude/."])(
    "rejects the . segment in %j",
    (value) => {
      expect(() => validateProfilePathForm(value, "claudeConfigDir")).toThrow(
        / \. path/u,
      );
    },
  );

  it("rejects non-NFC strings", () => {
    const decomposed = "/srv/cafe\u0301";
    expect(decomposed).not.toBe(decomposed.normalize("NFC"));
    expect(() =>
      validateProfilePathForm(decomposed, "claudeConfigDir"),
    ).toThrow(/NFC/u);
    expect(() =>
      validateProfilePathForm(decomposed.normalize("NFC"), "claudeConfigDir"),
    ).not.toThrow();
  });

  it.each([
    ["NUL U+0000", "\u0000"],
    ["US U+001F", "\u001f"],
    ["DEL U+007F", "\u007f"],
    ["PAD U+0080", "\u0080"],
    ["NEL U+0085", "\u0085"],
    ["APC U+009F", "\u009f"],
    ["ALM U+061C", "\u061c"],
    ["ZWSP U+200B", "\u200b"],
    ["ZWJ U+200D", "\u200d"],
    ["LRM U+200E", "\u200e"],
    ["RLM U+200F", "\u200f"],
    ["LRE U+202A", "\u202a"],
    ["RLE U+202B", "\u202b"],
    ["PDF U+202C", "\u202c"],
    ["LRO U+202D", "\u202d"],
    ["RLO U+202E", "\u202e"],
    ["LS U+2028", "\u2028"],
    ["PS U+2029", "\u2029"],
    ["WJ U+2060", "\u2060"],
    ["LRI U+2066", "\u2066"],
    ["RLI U+2067", "\u2067"],
    ["FSI U+2068", "\u2068"],
    ["PDI U+2069", "\u2069"],
    ["BOM U+FEFF", "\ufeff"],
  ])(
    "rejects %s as a control, bidi or invisible character",
    (_label, character) => {
      expect(() =>
        validateProfilePathForm(`/srv/a${character}b`, "claudeConfigDir"),
      ).toThrow(/control or bidi character, or an invisible one/u);
      expect(() =>
        validateProfilePathForm(`~/a${character}b`, "claudeConfigDir"),
      ).toThrow(/control or bidi character, or an invisible one/u);
    },
  );
});

describe("keychain service and login command", () => {
  it("derives the suffix from the first 8 hex of sha256 of the dir", () => {
    const dir = "/Users/example/.claude-work";
    const expected = createHash("sha256").update(dir).digest("hex").slice(0, 8);
    expect(claudeConfigDirKeychainService(dir)).toBe(
      `Claude Code-credentials-${expected}`,
    );
  });

  it("single-quotes the exact normalized dir", () => {
    expect(claudeConfigDirLoginCommand("/srv/with space/dir")).toBe(
      "CLAUDE_CONFIG_DIR='/srv/with space/dir' claude auth login",
    );
  });
});
