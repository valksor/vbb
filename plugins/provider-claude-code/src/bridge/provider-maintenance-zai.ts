import {
  type ProviderUsage,
  type ProviderUsageResult,
  type ProviderUsageWindow,
  experimental_clampPercent as clampPercent,
} from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";
import { containsControlBidiOrInvisibleCharacter } from "../config-dir.js";
import {
  isZaiUsageBaseUrl,
  nonessentialTrafficDisabled,
} from "../token-profile-rules.js";
import type { ActiveTokenProfile } from "./profile-env.js";
import { readProfileToken } from "./profile-token.js";

const ZAI_USAGE_FETCH_TIMEOUT_MS = 15_000;
const ZAI_USAGE_PATH = "/api/monitor/usage/quota/limit";
const ZAI_USAGE_BODY_MAX_BYTES = 65_536;

const zaiUsageMessageSchema = z
  .string()
  .max(200)
  .refine((value) => !containsControlBidiOrInvisibleCharacter(value))
  .nullish()
  .catch(null);

const zaiUsageLimitSchema = z.object({
  type: z.string().nullish(),
  unit: z.number().nullish(),
  number: z.number().nullish(),
  percentage: z.number(),
  nextResetTime: z.number().nullish(),
});

const zaiUsageStatusSchema = z
  .object({
    code: z.number(),
    success: z.boolean(),
    msg: zaiUsageMessageSchema,
  })
  .passthrough();

const zaiUsageDataSchema = z.object({
  level: z
    .string()
    .regex(/^[a-z0-9_-]{1,16}$/u)
    .nullish()
    .catch(null),
  limits: z.array(zaiUsageLimitSchema.nullable().catch(null)),
});

type ZaiUsageData = z.infer<typeof zaiUsageDataSchema>;

const ZAI_USAGE_KNOWN_LABELS: ReadonlySet<string> = new Set([
  "five-hour limit",
  "weekly limit",
  "mcp tools (monthly)",
]);

function zaiResetIso(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const parsed = new Date(value);
  const year = parsed.getUTCFullYear();
  return year >= 2020 && year <= 2100 ? parsed.toISOString() : null;
}

function zaiUsageWindows(
  limits: ZaiUsageData["limits"],
): ProviderUsageWindow[] {
  const windows: ProviderUsageWindow[] = [];
  const knownCounts = new Map<string, number>();
  let unknownOrdinal = 0;
  for (const limit of limits) {
    if (limit === null) continue;
    let kind: "five-hour" | "weekly" | "custom" = "custom";
    let label: string;
    if (limit.unit === 3 && limit.number === 5) {
      kind = "five-hour";
      label = "Five-hour limit";
    } else if (limit.unit === 6 && limit.number === 1) {
      kind = "weekly";
      label = "Weekly limit";
    } else if (limit.type === "TIME_LIMIT") {
      label = "MCP tools (monthly)";
    } else {
      unknownOrdinal += 1;
      label = `Usage limit ${unknownOrdinal}`;
    }
    const key = label.toLowerCase();
    if (ZAI_USAGE_KNOWN_LABELS.has(key)) {
      const count = (knownCounts.get(key) ?? 0) + 1;
      knownCounts.set(key, count);
      if (count > 1) {
        kind = "custom";
        label = `${label} (${count})`;
      }
    }
    windows.push({
      kind,
      label,
      usedPercent: clampPercent(limit.percentage),
      resetsAt: zaiResetIso(limit.nextResetTime),
    });
  }
  return windows;
}

function normalizeZaiUsage(data: ZaiUsageData): ProviderUsage {
  const level = data.level;
  return {
    status: "ok",
    accountEmail: null,
    planLabel:
      level === null || level === undefined
        ? null
        : `GLM Coding ${level.charAt(0).toUpperCase()}${level.slice(1)}`,
    plan: null,
    accountKey: null,
    windows: zaiUsageWindows(data.limits),
  };
}

function zaiUsageError(message: string): ProviderUsageResult {
  return {
    supported: true,
    usage: { status: "error", message, planLabel: null, accountEmail: null },
  };
}

async function readZaiUsageBody(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString("utf8");
    total += value.byteLength;
    if (total > ZAI_USAGE_BODY_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
}

function zaiUsageFromBody(body: string): ProviderUsageResult {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return zaiUsageError("GLM usage response was malformed.");
  }
  const status = zaiUsageStatusSchema.safeParse(raw);
  if (!status.success) {
    return zaiUsageError("GLM usage response was malformed.");
  }
  if (status.data.code === 401 || status.data.code === 403) {
    return { supported: true, usage: { status: "expired" } };
  }
  if (!status.data.success) {
    return zaiUsageError(
      status.data.msg === null
        ? "GLM usage request failed."
        : `GLM usage request failed: ${status.data.msg}`,
    );
  }
  const parsed = zaiUsageDataSchema.safeParse(status.data.data);
  if (!parsed.success) {
    return zaiUsageError("GLM usage response was malformed.");
  }
  return { supported: true, usage: normalizeZaiUsage(parsed.data) };
}

export async function zaiTokenProfileUsage(
  profile: ActiveTokenProfile,
): Promise<ProviderUsageResult> {
  if (
    !isZaiUsageBaseUrl(profile.env.ANTHROPIC_BASE_URL) ||
    nonessentialTrafficDisabled(profile.env)
  ) {
    return { supported: false };
  }
  let token: string;
  try {
    token = readProfileToken(profile.authTokenFile);
  } catch {
    return { supported: true, usage: { status: "unauthenticated" } };
  }
  const url = new URL(
    ZAI_USAGE_PATH,
    new URL(profile.env.ANTHROPIC_BASE_URL).origin,
  );
  try {
    const response = await fetch(url, {
      headers: { Authorization: token, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(ZAI_USAGE_FETCH_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) {
      return { supported: true, usage: { status: "expired" } };
    }
    if (!response.ok) {
      return zaiUsageError(
        `GLM usage request failed (HTTP ${response.status}).`,
      );
    }
    const body = await readZaiUsageBody(response);
    if (body === null) {
      return zaiUsageError("GLM usage response was too large.");
    }
    return zaiUsageFromBody(body);
  } catch (error) {
    const timedOut =
      error instanceof Error &&
      (error.name === "TimeoutError" || error.name === "AbortError");
    return zaiUsageError(
      timedOut ? "GLM usage request timed out." : "GLM usage request failed.",
    );
  }
}
