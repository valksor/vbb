import { usageRpcSuccessSchema, type UsageSnapshot } from "./usage-schema.js";

export const CARD_MAX_AGE_MS = 2 * 60_000;
export const FOCUS_MAX_AGE_MS = 5 * 60_000;

function rpcErrorMessage(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const error = Reflect.get(body, "error");
  if (typeof error === "string") return error;
  if (typeof error !== "object" || error === null) return null;
  const message = Reflect.get(error, "message");
  return typeof message === "string" ? message : null;
}

export async function fetchUsageSnapshot({
  pluginId,
  force,
  machineIds,
  maxAgeMs,
  providerIds,
  signal,
}: {
  pluginId: string;
  force: boolean;
  machineIds: string[] | null;
  maxAgeMs: number;
  providerIds: string[];
  signal?: AbortSignal;
}): Promise<UsageSnapshot> {
  const response = await fetch(
    `/api/v1/plugins/${encodeURIComponent(pluginId)}/rpc/getUsage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force, machineIds, maxAgeMs, providerIds }),
      signal:
        signal === undefined
          ? AbortSignal.timeout(60_000)
          : AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    },
  );
  if (!response.ok)
    throw new Error(`Usage request returned HTTP ${response.status}.`);
  const body: unknown = await response.json();
  const parsed = usageRpcSuccessSchema.safeParse(body);
  if (!parsed.success) {
    throw new Error(
      rpcErrorMessage(body) ?? "Provider usage could not be loaded.",
    );
  }
  return parsed.data.result;
}
