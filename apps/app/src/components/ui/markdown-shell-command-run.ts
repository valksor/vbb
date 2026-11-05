import {
  OPEN_IN_TARGET_COMMAND_INVISIBLE_CHARACTER_PATTERN,
  OPEN_IN_TARGET_COMMAND_MAX_LENGTH,
  openInTargetCommandHasRejectedCharacter,
  type OpenInTargetCommandLanguage,
} from "@bb/host-daemon-contract";

export const RUNNABLE_SHELL_CODE_LANGUAGES: readonly OpenInTargetCommandLanguage[] =
  ["bash", "sh", "shell", "zsh"];

const SHELL_COMMAND_COMMENT_LINE_PATTERN = /^\s*(#.*)?$/;

export type MarkdownShellCommandRunner = (
  code: string,
  language: string,
) => void;

export function isRunnableShellCodeLanguage(
  language: string | null,
): language is OpenInTargetCommandLanguage {
  return (
    language !== null &&
    RUNNABLE_SHELL_CODE_LANGUAGES.includes(
      language as OpenInTargetCommandLanguage,
    )
  );
}

export function isRunnableShellCodeBlock({ code }: { code: string }): boolean {
  if (
    code.trim().length === 0 ||
    code.length > OPEN_IN_TARGET_COMMAND_MAX_LENGTH ||
    openInTargetCommandHasRejectedCharacter(code)
  ) {
    return false;
  }
  return !code.split("\n").every((line) =>
    SHELL_COMMAND_COMMENT_LINE_PATTERN.test(line),
  );
}

export function stripBidiControlCharacters(text: string): string {
  return text.replace(OPEN_IN_TARGET_COMMAND_INVISIBLE_CHARACTER_PATTERN, "");
}
