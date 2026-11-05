import type {
  PluginProviderDeclaration,
  PluginProviderStrings,
} from "@get-bb/plugin-sdk";
import { CLAUDE_NATIVE_ROOTS_DECLARATION } from "./native-roots.js";
import { isTokenProfile, type ClaudeCodeProfile } from "./profiles.js";
import {
  isZaiUsageBaseUrl,
  nonessentialTrafficDisabled,
} from "./token-profile-rules.js";

const DEFAULT_PROVIDER_ID = "claude-code";

function profileSignInCommand(configDir: string): string {
  const target = configDir.startsWith("~/")
    ? `"$HOME/${configDir.slice(2)}"`
    : `'${configDir}'`;
  return `CLAUDE_CONFIG_DIR=${target} claude auth login`;
}

function profileBridgeOptions(
  profile: ClaudeCodeProfile,
): Record<string, string | Record<string, string>> {
  return isTokenProfile(profile)
    ? { claudeAuthTokenFile: profile.authTokenFile, claudeEnv: profile.env }
    : { claudeConfigDir: profile.configDir };
}

function profileHints(
  profile: ClaudeCodeProfile | undefined,
): Pick<PluginProviderStrings, "signInHint" | "expiredHint"> {
  if (profile !== undefined && isTokenProfile(profile)) {
    const hint = `Put the API token for this profile in ${profile.authTokenFile} (chmod 600), then reload.`;
    return { signInHint: hint, expiredHint: hint };
  }
  const signInCommand =
    profile === undefined ? undefined : profileSignInCommand(profile.configDir);
  return {
    signInHint:
      signInCommand === undefined
        ? "Run `claude` on the machine to sign in."
        : `Run \`${signInCommand}\` on the machine to sign in.`,
    expiredHint:
      signInCommand === undefined
        ? "Your Claude session expired. Run `claude`, then reload."
        : `Your Claude session expired. Run \`${signInCommand}\`, then reload.`,
  };
}

export function claudeCodeProviderDeclaration(
  profile?: ClaudeCodeProfile,
): PluginProviderDeclaration {
  const tokenProfile = profile !== undefined && isTokenProfile(profile);
  return {
    id:
      profile === undefined
        ? DEFAULT_PROVIDER_ID
        : `${DEFAULT_PROVIDER_ID}-${profile.id}`,
    displayName: profile?.displayName ?? "Claude Code",
    ...(profile === undefined
      ? {}
      : {
          family: DEFAULT_PROVIDER_ID,
          experimental_bridgeOptions: profileBridgeOptions(profile),
        }),
    icon: "./icons/claude-code.svg",
    strings: {
      ...profileHints(profile),
      installUrl: "https://claude.com/claude-code",
      brandPrefix: "Claude ",
      planModeCopy:
        "Claude Code will plan without normal full-access execution.",
      iconTint: { light: "#D97757", dark: "#D97757" },
    },
    ...CLAUDE_NATIVE_ROOTS_DECLARATION,
    ...(profile === undefined || tokenProfile
      ? {}
      : {
          experimental_nativeSkillRoots: {
            project:
              CLAUDE_NATIVE_ROOTS_DECLARATION.experimental_nativeSkillRoots
                ?.project ?? [],
          },
        }),
    maintenance: {
      health: true,
      usage:
        !tokenProfile ||
        (isTokenProfile(profile) &&
          isZaiUsageBaseUrl(profile.env.ANTHROPIC_BASE_URL) &&
          !nonessentialTrafficDisabled(profile.env)),
      installation: profile === undefined,
    },
    capabilities: {
      supportsServiceTier: !tokenProfile,
      supportsNativeUserQuestion: true,
      fork: "checkpoint",
      supportsManualCompaction: true,
      supportsThreadArchive: false,
      supportsThreadRename: false,
      permissionModes: tokenProfile
        ? ["accept-edits", "full"]
        : ["accept-edits", "auto", "full"],
      reasoningLevels: ["low", "medium", "high", "xhigh", "ultracode", "max"],
    },
    reasoningLevels: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      {
        id: "ultracode",
        label: "Ultracode",
        description: "Extra-high effort plus standing workflow orchestration.",
      },
      { id: "max", label: "Max" },
    ],
    ...(tokenProfile
      ? {}
      : {
          serviceTiers: [
            { id: "default", label: "Default" },
            {
              id: "fast",
              label: "Fast",
              description:
                "Faster responses on supported Opus models at a higher cost per token.",
            },
          ],
        }),
    composerActions: ["plan"],
    completedTurnDisplay: "flat",
    env: {
      passthrough:
        profile === undefined
          ? ["BB_CLAUDE_CODE_EXECUTABLE", "CLAUDE_CODE_OAUTH_TOKEN"]
          : ["BB_CLAUDE_CODE_EXECUTABLE"],
    },
    models: { scope: "host" },
    deriveProviderOptions(context) {
      return {
        memoryEnabled: context.settings.memoryEnabled !== false,
        providerSubagentsEnabled: context.settings.subagentsDisabled !== true,
        workflowsEnabled: context.settings.workflowsDisabled !== true,
        chromeEnabled: context.settings.chromeEnabled === true,
        disable1MContext: context.settings.disable1MContext === true,
        artifactsEnabled: context.settings.artifactsEnabled === true,
        sandboxEnabled: context.settings.sandboxEnabled !== false,
        fullAccessApprovalsEnabled:
          context.settings.fullAccessApprovalsEnabled === true,
        commandDescriptionsEnabled:
          context.settings.commandDescriptionsEnabled === true,
        ...(context.promptMode === "plan"
          ? { claudeCodePermissionMode: "plan" }
          : {}),
      };
    },
  };
}
