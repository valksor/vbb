import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { containsControlBidiOrInvisibleCharacter } from "../config-dir.js";

const TOKEN_FILE_MAX_BYTES = 4096;
const SURROUNDING_WHITESPACE = /^\s|\s$/u;
const TOKEN_FILE_PERMISSION_MASK = 0o077;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export class ProfileTokenError extends Error {
  constructor(file: string, problem: string, fix: string) {
    super(`The API token file ${file} ${problem}. Fix: ${fix}`);
    this.name = "ProfileTokenError";
  }
}

function openTokenFile(file: string): number {
  const noFollow = constants.O_NOFOLLOW;
  const currentUid = process.getuid?.();
  if (noFollow === undefined || currentUid === undefined) {
    throw new ProfileTokenError(
      file,
      "cannot be verified on this platform",
      "use a token profile on macOS or Linux",
    );
  }
  try {
    return openSync(file, constants.O_RDONLY | noFollow | constants.O_NONBLOCK);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new ProfileTokenError(
        file,
        "does not exist",
        `create it containing the API token, then run chmod 600 ${shellQuote(file)}`,
      );
    }
    if (code === "ELOOP") {
      throw new ProfileTokenError(
        file,
        "is a symlink",
        "point authTokenFile at the real file",
      );
    }
    throw new ProfileTokenError(
      file,
      `cannot be opened (${code ?? "unknown error"})`,
      `make it a readable regular file owned by you, then run chmod 600 ${shellQuote(file)}`,
    );
  }
}

export function readProfileToken(file: string): string {
  const descriptor = openTokenFile(file);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile()) {
      throw new ProfileTokenError(
        file,
        "is not a regular file",
        "point authTokenFile at a regular file",
      );
    }
    if (stats.uid !== process.getuid?.()) {
      throw new ProfileTokenError(
        file,
        "is not owned by the current user",
        `run chown "$USER" ${shellQuote(file)}`,
      );
    }
    if ((stats.mode & TOKEN_FILE_PERMISSION_MASK) !== 0) {
      throw new ProfileTokenError(
        file,
        `has mode 0${(stats.mode & 0o777).toString(8)}`,
        `run chmod 600 ${shellQuote(file)}`,
      );
    }
    if (stats.size > TOKEN_FILE_MAX_BYTES) {
      throw new ProfileTokenError(
        file,
        `is larger than ${TOKEN_FILE_MAX_BYTES} bytes`,
        "put only the API token in it",
      );
    }
    const buffer = Buffer.alloc(stats.size);
    let offset = 0;
    while (offset < buffer.length) {
      const read = readSync(
        descriptor,
        buffer,
        offset,
        buffer.length - offset,
        null,
      );
      if (read === 0) break;
      offset += read;
    }
    const content = buffer.toString("utf8", 0, offset);
    const token = content.replace(/\r?\n$/u, "");
    if (token.length === 0) {
      throw new ProfileTokenError(file, "is empty", "put the API token in it");
    }
    if (SURROUNDING_WHITESPACE.test(token)) {
      throw new ProfileTokenError(
        file,
        "has whitespace before or after the token",
        "keep only the API token, followed by at most one newline",
      );
    }
    if (containsControlBidiOrInvisibleCharacter(token)) {
      throw new ProfileTokenError(
        file,
        "contains a control or invisible character",
        "put only the API token in it, without extra lines or spaces around it",
      );
    }
    return token;
  } finally {
    closeSync(descriptor);
  }
}
