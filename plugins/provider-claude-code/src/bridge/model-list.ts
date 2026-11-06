import { type AvailableModel } from "@get-bb/plugin-sdk/provider-bridge";
import { buildClaudeCodeModels } from "../model-list.js";
import { probeClaudeInitialization } from "./initialization-probe.js";
import {
  probeTokenProfileModels,
  type ModelProbeTarget,
  type TokenProfileSettingsSource,
} from "./model-list.token.fork.js";

async function probeClaudeCodeModels(env: NodeJS.ProcessEnv): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  const initialization = await probeClaudeInitialization({
    env,
    cwd: process.cwd(),
    settingsFile: null,
  });
  if (initialization.models.length === 0) {
    throw new Error("Claude Code reported no models.");
  }
  return buildClaudeCodeModels(initialization.models);
}

export async function listClaudeCodeBridgeModels(
  env: NodeJS.ProcessEnv,
  tokenProfile: TokenProfileSettingsSource | null = null,
): ReturnType<typeof probeClaudeCodeModels> {
  if (tokenProfile !== null) return probeTokenProfileModels(env, tokenProfile);
  try {
    return await probeClaudeCodeModels(env);
  } catch (error) {
    if (
      env.ANTHROPIC_MODEL &&
      error instanceof Error &&
      error.message.includes("--client-data-url:") &&
      error.message.includes("pass the matching --model")
    ) {
      return probeClaudeCodeModels({ ...env, ANTHROPIC_MODEL: undefined });
    }
    throw error;
  }
}

interface ClaudeCodeBridgeModelListMemoOptions {
  list?: (
    target: ModelProbeTarget,
  ) => ReturnType<typeof listClaudeCodeBridgeModels>;
  now?: () => number;
  ttlMs: number;
}

export function createClaudeCodeBridgeModelListMemo({
  list = ({ env, tokenProfile }) =>
    listClaudeCodeBridgeModels(env, tokenProfile),
  now = Date.now,
  ttlMs,
}: ClaudeCodeBridgeModelListMemoOptions): (
  buildTarget: () => ModelProbeTarget,
) => ReturnType<typeof listClaudeCodeBridgeModels> {
  type Catalog = Awaited<ReturnType<typeof listClaudeCodeBridgeModels>>;
  let settled: { catalog: Catalog; expiresAt: number } | null = null;
  let pending: Promise<Catalog> | null = null;
  return (buildTarget) => {
    const target = buildTarget();
    if (settled !== null && settled.expiresAt > now()) {
      return Promise.resolve(settled.catalog);
    }
    settled = null;
    if (pending !== null) {
      return pending;
    }
    const probe = list(target)
      .then((catalog) => {
        settled = { catalog, expiresAt: now() + ttlMs };
        return catalog;
      })
      .finally(() => {
        if (pending === probe) {
          pending = null;
        }
      });
    pending = probe;
    return probe;
  };
}
