import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readProfileToken } from "./profile-token.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bb-profile-token-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function tokenFile(content: string | Buffer, mode = 0o600): string {
  const file = join(dir, "token");
  writeFileSync(file, content);
  chmodSync(file, mode);
  return file;
}

describe("readProfileToken", () => {
  it("returns the token and trims exactly one trailing newline", () => {
    expect(readProfileToken(tokenFile("abc123"))).toBe("abc123");
    expect(readProfileToken(tokenFile("abc123\n"))).toBe("abc123");
    expect(readProfileToken(tokenFile("abc123\r\n"))).toBe("abc123");
  });

  it("reads the file fresh each time so a rotated token is picked up", () => {
    const file = tokenFile("first\n");
    expect(readProfileToken(file)).toBe("first");
    writeFileSync(file, "second\n");
    expect(readProfileToken(file)).toBe("second");
  });

  it("refuses a missing file and names the fix", () => {
    expect(() => readProfileToken(join(dir, "absent"))).toThrow(
      /does not exist.*chmod 600 '.*absent'/su,
    );
  });

  it.each(["", "\n", "\r\n"])("treats the content %j as missing", (content) => {
    expect(() => readProfileToken(tokenFile(content))).toThrow(/is empty/u);
  });

  it("refuses whitespace around the token other than one trailing newline", () => {
    for (const content of [" abc", "abc ", "abc\n\n", "abc \n", "\n abc"]) {
      expect(() => readProfileToken(tokenFile(content))).toThrow(
        /whitespace before or after the token/u,
      );
    }
  });

  it("refuses interior control characters", () => {
    expect(() => readProfileToken(tokenFile("ab\nc"))).toThrow(
      /control or invisible character/u,
    );
    expect(() => readProfileToken(tokenFile("ab\u0000c"))).toThrow(
      /control or invisible character/u,
    );
    expect(() => readProfileToken(tokenFile("ab‮c"))).toThrow(
      /control or invisible character/u,
    );
  });

  it.each([0o644, 0o640, 0o604, 0o660, 0o666])(
    "refuses mode %o and tells the owner to chmod 600",
    (mode) => {
      const file = tokenFile("abc", mode);
      expect(() => readProfileToken(file)).toThrow(
        new RegExp(`has mode 0${mode.toString(8)}.*chmod 600 `, "su"),
      );
    },
  );

  it("accepts mode 0400", () => {
    expect(readProfileToken(tokenFile("abc", 0o400))).toBe("abc");
  });

  it("refuses a symlink even when it points at a valid token file", () => {
    const real = tokenFile("abc");
    const link = join(dir, "link");
    symlinkSync(real, link);
    expect(() => readProfileToken(link)).toThrow(/is a symlink/u);
  });

  it("refuses a directory", () => {
    expect(() => readProfileToken(dir)).toThrow(/not a regular file/u);
  });

  it("refuses a FIFO without hanging", () => {
    const fifo = join(dir, "fifo");
    execFileSync("mkfifo", [fifo]);
    chmodSync(fifo, 0o600);
    expect(() => readProfileToken(fifo)).toThrow(/not a regular file/u);
  });

  it("refuses a file over 4 KB and accepts exactly 4 KB", () => {
    expect(() => readProfileToken(tokenFile("a".repeat(4097)))).toThrow(
      /larger than 4096 bytes/u,
    );
    expect(readProfileToken(tokenFile("a".repeat(4096)))).toBe(
      "a".repeat(4096),
    );
  });
});
