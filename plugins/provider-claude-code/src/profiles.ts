import { z } from "zod";
import { validateProfilePathForm } from "./config-dir.js";

const PROFILE_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const PROFILE_ID_MAX_LENGTH = 41;
const DISPLAY_NAME_MAX_LENGTH = 80;

const loginProfileSchema = z
  .object({
    id: z
      .string()
      .max(PROFILE_ID_MAX_LENGTH)
      .regex(PROFILE_ID_PATTERN, {
        message: `must match ${PROFILE_ID_PATTERN.source}`,
      }),
    displayName: z
      .string()
      .refine(
        (value) =>
          value.trim().length > 0 && value.length <= DISPLAY_NAME_MAX_LENGTH,
        {
          message: `must be non-blank and at most ${DISPLAY_NAME_MAX_LENGTH} characters`,
        },
      ),
    configDir: z.string().superRefine((value, context) => {
      try {
        validateProfilePathForm(value, "claudeConfigDir");
      } catch (error) {
        context.addIssue({
          code: "custom",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  })
  .strict();

export type ClaudeCodeProfile = z.infer<typeof loginProfileSchema>;

type ParsedProfile = { profile: ClaudeCodeProfile } | { details: string };

function parseProfile(entry: unknown): ParsedProfile {
  const result = loginProfileSchema.safeParse(entry);
  if (result.success) return { profile: result.data };
  return {
    details: result.error.issues
      .map((issue) => {
        const field = issue.path.join(".");
        return field.length === 0 || issue.message.startsWith(field)
          ? issue.message
          : `${field} ${issue.message}`;
      })
      .join("; "),
  };
}

export interface ResolveClaudeCodeProfilesResult {
  profiles: ClaudeCodeProfile[];
  warnings: string[];
}

export function resolveClaudeCodeProfiles(
  settingValue: string | undefined,
): ResolveClaudeCodeProfilesResult {
  const profiles: ClaudeCodeProfile[] = [];
  const warnings: string[] = [];
  const trimmed = settingValue?.trim() ?? "";
  if (trimmed.length === 0) return { profiles, warnings };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    warnings.push(
      `The Claude Code "profiles" setting is not valid JSON; ignoring it: ${String(error)}`,
    );
    return { profiles, warnings };
  }
  if (!Array.isArray(parsed)) {
    warnings.push(
      'The Claude Code "profiles" setting must be a JSON array; ignoring it.',
    );
    return { profiles, warnings };
  }
  const seen = new Set<string>();
  parsed.forEach((entry: unknown, index) => {
    const result = parseProfile(entry);
    if ("details" in result) {
      warnings.push(
        `Claude Code profile #${index + 1} is not valid (${result.details}); skipping it.`,
      );
      return;
    }
    if (seen.has(result.profile.id)) {
      warnings.push(
        `Claude Code profile #${index + 1} repeats the id "${result.profile.id}"; skipping it.`,
      );
      return;
    }
    seen.add(result.profile.id);
    profiles.push(result.profile);
  });
  return { profiles, warnings };
}
