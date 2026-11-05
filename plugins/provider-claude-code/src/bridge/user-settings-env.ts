import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

const userSettingsSchema = z.object({
  env: z.record(z.string(), z.unknown()).optional(),
});

export function readUserSettingsEnv(): Record<string, string> {
  let raw: string;
  try {
    raw = readFileSync(join(homedir(), ".claude", "settings.json"), "utf8");
  } catch {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const result = userSettingsSchema.safeParse(parsed);
  if (!result.success) return {};
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(result.data.env ?? {})) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      env[name] = String(value);
    }
  }
  return env;
}
