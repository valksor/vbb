import type { BbPluginApi, PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { claudeCodeProviderDeclaration } from "./declaration.js";
import {
  resolveClaudeCodeProfiles,
  type ClaudeCodeProfile,
} from "./profiles.js";

const PROFILES_SETTING_DESCRIPTION =
  'A JSON array of extra Claude Code login profiles. Each profile has id, displayName and configDir, for example {"id":"work","displayName":"Claude Work","configDir":"~/.claude-work"}. See the guide for details.';

export const CLAUDE_CODE_PROFILES_SETTING = {
  profiles: {
    type: "string",
    label: "Profiles",
    description: PROFILES_SETTING_DESCRIPTION,
    experimental_multiline: true,
    experimental_schema: z.string().superRefine((value, context) => {
      const { warnings } = resolveClaudeCodeProfiles(value);
      if (warnings.length > 0) {
        context.addIssue({ code: "custom", message: warnings.join(" ") });
      }
    }),
    default: "",
  },
} satisfies Record<string, PluginSettingDescriptor>;

interface ClaudeCodeProfilesSettingHandle {
  get(): Promise<{ profiles: string }>;
  onChange(listener: (next: { profiles: string }) => void): void;
}

export async function registerClaudeCodeProfiles(
  bb: BbPluginApi,
  settings: ClaudeCodeProfilesSettingHandle,
): Promise<void> {
  const registered = new Map<string, { key: string; dispose(): void }>();
  let disposed = false;

  function reconcile(profiles: readonly ClaudeCodeProfile[]): void {
    const desired = new Map(profiles.map((profile) => [profile.id, profile]));
    for (const [id, entry] of [...registered]) {
      const next = desired.get(id);
      if (next !== undefined && JSON.stringify(next) === entry.key) continue;
      entry.dispose();
      registered.delete(id);
    }
    for (const [id, profile] of desired) {
      if (registered.has(id)) continue;
      const declaration = claudeCodeProviderDeclaration(profile);
      try {
        const { dispose } = bb.providers.register(declaration);
        registered.set(id, { key: JSON.stringify(profile), dispose });
      } catch (error) {
        bb.log.error(
          `Could not register Claude Code provider "${declaration.id}": ${String(error)}`,
        );
      }
    }
  }

  function resolveAndReconcile(settingValue: string): void {
    if (disposed) return;
    const resolved = resolveClaudeCodeProfiles(settingValue);
    for (const warning of resolved.warnings) bb.log.warn(warning);
    reconcile(resolved.profiles);
    if (resolved.profiles.length > 0) {
      bb.log.info(
        `Registered ${resolved.profiles.length} Claude Code profile(s).`,
      );
    }
  }

  let pending: Promise<void> = Promise.resolve();
  function queueReconcile(settingValue: string): Promise<void> {
    pending = pending
      .catch(() => undefined)
      .then(() => resolveAndReconcile(settingValue));
    return pending;
  }

  const initial = await settings.get();
  await queueReconcile(initial.profiles);
  settings.onChange((next) => {
    void queueReconcile(next.profiles).catch((error: unknown) => {
      bb.log.error(
        `Could not re-register the Claude Code profiles: ${String(error)}`,
      );
    });
  });

  bb.onDispose(() => {
    disposed = true;
    for (const [, entry] of registered) entry.dispose();
    registered.clear();
  });
}
