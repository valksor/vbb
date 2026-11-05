import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const KEYCHAIN_SERVICE_PREFIX = "Claude Code-credentials-";
const REJECTED_CHARACTERS = ["$", "`", '"', "'", "\\", "!"] as const;
const CONTROL_BIDI_OR_INVISIBLE_CHARACTER =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u;

function normalizeDirectory(value: string): string {
  return path.resolve(value).normalize("NFC");
}

export function containsControlBidiOrInvisibleCharacter(
  value: string,
): boolean {
  return CONTROL_BIDI_OR_INVISIBLE_CHARACTER.test(value);
}

export function validateProfilePathForm(raw: string, label: string): void {
  for (const character of REJECTED_CHARACTERS) {
    if (raw.includes(character)) {
      throw new Error(`${label} must not contain the character ${character}`);
    }
  }
  if (containsControlBidiOrInvisibleCharacter(raw)) {
    throw new Error(
      `${label} must not contain a control or bidi character, or an invisible one`,
    );
  }
  if (raw !== raw.normalize("NFC")) {
    throw new Error(`${label} must be NFC-normalized Unicode`);
  }
  const homeRelative = raw === "~" || raw.startsWith("~/");
  if (!homeRelative && !path.isAbsolute(raw)) {
    throw new Error(`${label} must be an absolute path or start with ~/`);
  }
  if (raw.split("/").includes("..")) {
    throw new Error(`${label} must not contain a .. path segment`);
  }
  if (homeRelative && path.posix.normalize(`/${raw.slice(1)}`) === "/") {
    throw new Error(`${label} must not be the home directory`);
  }
  if (raw === "/") {
    throw new Error(`${label} must not be the filesystem root`);
  }
  if (raw.endsWith("/")) {
    throw new Error(`${label} must not end with a trailing /`);
  }
  if (raw.includes("//")) {
    throw new Error(`${label} must not contain an empty path segment`);
  }
  if (raw.split("/").includes(".")) {
    throw new Error(`${label} must not contain a . path segment`);
  }
}

export function parseProfilePath(
  raw: string,
  label: string,
  home: string = os.homedir(),
): string {
  validateProfilePathForm(raw, label);
  const expanded =
    raw === "~" || raw.startsWith("~/") ? home + raw.slice(1) : raw;
  const normalized = normalizeDirectory(expanded);
  if (normalized === normalizeDirectory(home)) {
    throw new Error(`${label} must not be the home directory`);
  }
  return normalized;
}

export function parseClaudeConfigDir(
  raw: string,
  home: string = os.homedir(),
): string {
  return parseProfilePath(raw, "claudeConfigDir", home);
}

export function claudeConfigDirKeychainService(configDir: string): string {
  const digest = createHash("sha256").update(configDir).digest("hex");
  return `${KEYCHAIN_SERVICE_PREFIX}${digest.slice(0, 8)}`;
}

export function claudeConfigDirLoginCommand(configDir: string): string {
  return `CLAUDE_CONFIG_DIR='${configDir}' claude auth login`;
}
