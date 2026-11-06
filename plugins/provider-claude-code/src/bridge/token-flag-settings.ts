import {
  closeSync,
  constants,
  fchmodSync,
  lstatSync,
  openSync,
  rmSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Options, Settings } from "@anthropic-ai/claude-agent-sdk";

const TOKEN_ENV_KEY = "ANTHROPIC_AUTH_TOKEN";
const PRIVATE_FILE_MODE = 0o600;
const GROUP_OR_OTHER_PERMISSIONS = 0o077;

const EXIT_CLEANUP_KEY = Symbol.for("bb.provider-claude-code.token-settings");

interface ExitCleanup {
  paths: Set<string>;
}

function exitCleanup(): ExitCleanup {
  const holder = globalThis as { [EXIT_CLEANUP_KEY]?: ExitCleanup };
  if (holder[EXIT_CLEANUP_KEY] === undefined) {
    const cleanup: ExitCleanup = { paths: new Set() };
    holder[EXIT_CLEANUP_KEY] = cleanup;
    process.on("exit", () => {
      for (const path of cleanup.paths) {
        rmSync(path, { recursive: true, force: true });
      }
    });
  }
  return holder[EXIT_CLEANUP_KEY];
}

export function removeOnExit(path: string): void {
  exitCleanup().paths.add(path);
}

function assertPrivateDirectory(dir: string): void {
  const stats = lstatSync(dir);
  if (
    !stats.isDirectory() ||
    stats.uid !== process.getuid?.() ||
    (stats.mode & GROUP_OR_OTHER_PERMISSIONS) !== 0
  ) {
    throw new Error(
      `The directory ${dir} for the Claude token settings file must be a directory owned by you with no group or other permissions`,
    );
  }
}

export function requireProfileToken(env: NodeJS.ProcessEnv): string {
  const token = env[TOKEN_ENV_KEY];
  if (token === undefined || token.length === 0) {
    throw new Error(
      "The token profile session env has no ANTHROPIC_AUTH_TOKEN to write into its settings file",
    );
  }
  return token;
}

export function writeTokenFlagSettingsFile(args: {
  dir: string;
  settings: Settings;
  token: string;
}): string {
  assertPrivateDirectory(args.dir);
  const file = join(args.dir, `flag-settings-${randomUUID()}.json`);
  const descriptor = openSync(
    file,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      (constants.O_NOFOLLOW ?? 0),
    PRIVATE_FILE_MODE,
  );
  removeOnExit(file);
  try {
    fchmodSync(descriptor, PRIVATE_FILE_MODE);
    writeSync(
      descriptor,
      JSON.stringify({
        ...args.settings,
        env: { ...args.settings.env, [TOKEN_ENV_KEY]: args.token },
      }),
    );
  } catch (error) {
    closeSync(descriptor);
    removeTokenFlagSettingsFile(file);
    throw error;
  }
  closeSync(descriptor);
  return file;
}

export function removeTokenFlagSettingsFile(file: string): void {
  exitCleanup().paths.delete(file);
  rmSync(file, { force: true });
}

function normalizeSandbox(
  sandbox: NonNullable<Options["sandbox"]>,
): NonNullable<Options["sandbox"]> {
  return sandbox.enabled === true && sandbox.failIfUnavailable === undefined
    ? { ...sandbox, failIfUnavailable: true }
    : sandbox;
}

export interface TokenFlagSettingsLease {
  settingsOption(fallback: Options["settings"]): {
    settings?: Options["settings"];
  };
  sandboxOption(): { sandbox?: Options["sandbox"] };
  release(): void;
}

export function acquireTokenFlagSettings(options: {
  tokenFlagSettingsDir?: string;
  settings?: Options["settings"];
  sandbox?: Options["sandbox"];
  env: NodeJS.ProcessEnv;
}): TokenFlagSettingsLease {
  const sandbox = options.sandbox;
  let file: string | null =
    options.tokenFlagSettingsDir === undefined
      ? null
      : writeTokenFlagSettingsFile({
          dir: options.tokenFlagSettingsDir,
          settings: {
            ...(typeof options.settings === "object" ? options.settings : {}),
            ...(sandbox ? { sandbox: normalizeSandbox(sandbox) } : {}),
          },
          token: requireProfileToken(options.env),
        });
  return {
    settingsOption(fallback) {
      if (file !== null) return { settings: file };
      return fallback ? { settings: fallback } : {};
    },
    sandboxOption() {
      if (file !== null) return {};
      return sandbox ? { sandbox } : {};
    },
    release() {
      if (file === null) return;
      removeTokenFlagSettingsFile(file);
      file = null;
    },
  };
}
