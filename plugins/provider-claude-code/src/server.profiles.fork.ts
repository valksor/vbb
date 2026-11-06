import type { BbPluginApi, PluginSettingDescriptor } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { claudeCodeProviderDeclaration } from "./declaration.js";
import {
  resolveClaudeCodeProfiles,
  type ClaudeCodeProfile,
} from "./profiles.js";

const PROFILES_SETTING_DESCRIPTION =
  'A JSON array of extra Claude Code profiles. A login profile has its own sign-in: id, displayName and configDir, for example {"id":"work","displayName":"Claude Work","configDir":"~/.claude-work"}. A token profile talks to another Anthropic-compatible endpoint with an API token read from a file (mode 600): id, displayName, authTokenFile and env with a required ANTHROPIC_BASE_URL and at least one model variable, for example {"id":"glm","displayName":"GLM","authTokenFile":"~/.config/bb/glm.token","env":{"ANTHROPIC_BASE_URL":"https://api.z.ai/api/anthropic","ANTHROPIC_DEFAULT_OPUS_MODEL":"glm-5.3[1m]","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.3-flashx[1m]","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-5.3-flash[1m]"}}. A profile is one kind or the other; see the guide for details.';

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
      if (next !== undefined && JSON.stringify(next) === entry.key) {
        continue;
      }
      entry.dispose();
      registered.delete(id);
    }
    for (const [id, profile] of desired) {
      if (registered.has(id)) {
        continue;
      }
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
    if (disposed) {
      return;
    }
    const resolved = resolveClaudeCodeProfiles(settingValue);
    for (const warning of resolved.warnings) {
      bb.log.warn(warning);
    }
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
    for (const [, entry] of registered) {
      entry.dispose();
    }
    registered.clear();
  });
}
