import { z } from "zod";

export const OPEN_IN_TARGET_COMMAND_MAX_LENGTH = 8_192;

export const OPEN_IN_TARGET_RUN_COMMAND_DISABLED_ERROR_CODE =
  "run_command_disabled";

const OPEN_IN_TARGET_COMMAND_INVISIBLE_CHARACTERS =
  "\\u061c\\u200b\\u200e-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff";

const openInTargetCommandRejectedCharacterPattern = new RegExp(
  `[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f${OPEN_IN_TARGET_COMMAND_INVISIBLE_CHARACTERS}]`,
  "u",
);

export function openInTargetCommandHasRejectedCharacter(
  command: string,
): boolean {
  return openInTargetCommandRejectedCharacterPattern.test(command);
}

export const openTargetCommandSchema = z
  .string()
  .min(1)
  .max(OPEN_IN_TARGET_COMMAND_MAX_LENGTH)
  .refine((command) => !openInTargetCommandHasRejectedCharacter(command), {
    message: "Command must not contain control characters",
  });

export const openTargetCommandLanguageSchema = z.enum([
  "sh",
  "bash",
  "zsh",
  "shell",
]);
export type OpenInTargetCommandLanguage = z.infer<
  typeof openTargetCommandLanguageSchema
>;

export interface OpenInTargetErrorResponse {
  code: string;
  message: string;
}

export function refineOpenInTargetCommand(
  value: { command?: string | undefined; language?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.language !== undefined && value.command === undefined) {
    ctx.addIssue({
      code: "custom",
      message: "language requires command",
      path: ["language"],
    });
  }
}
