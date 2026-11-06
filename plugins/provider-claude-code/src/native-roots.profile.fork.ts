import { type ExperimentalVendorPluginRoots } from "@get-bb/plugin-sdk/host";
import { z } from "zod";
import { parseClaudeConfigDir } from "./config-dir.js";
import { resolveClaudeNativeRoots } from "./native-roots.js";
import { tokenProfileBridgeOptionsSchema } from "./token-profile-rules.js";

const claudeBridgeOptionsSchema = z.object({
  claudeConfigDir: z.string().optional(),
  claudeAuthTokenFile: z.unknown().optional(),
  claudeEnv: z.unknown().optional(),
});

export interface ClaudeProviderNativeRootsArgs {
  cwd: string | null;
  bridgeOptions: Readonly<Record<string, unknown>> | undefined;
  homeDir: string;
  env: Readonly<Record<string, string | undefined>>;
}

export async function resolveClaudeProviderNativeRoots(
  args: ClaudeProviderNativeRootsArgs,
): Promise<ExperimentalVendorPluginRoots> {
  const { claudeConfigDir, claudeAuthTokenFile, claudeEnv } =
    claudeBridgeOptionsSchema.parse(args.bridgeOptions ?? {});
  if (claudeAuthTokenFile !== undefined || claudeEnv !== undefined) {
    tokenProfileBridgeOptionsSchema.parse({ claudeAuthTokenFile, claudeEnv });
    const { CLAUDE_CONFIG_DIR: _ambient, ...inheritedEnv } = args.env;
    return resolveClaudeNativeRoots({
      cwd: args.cwd,
      homeDir: args.homeDir,
      env: inheritedEnv,
    });
  }
  return resolveClaudeNativeRoots({
    cwd: args.cwd,
    homeDir: args.homeDir,
    env:
      claudeConfigDir === undefined
        ? args.env
        : {
            ...args.env,
            CLAUDE_CONFIG_DIR: parseClaudeConfigDir(
              claudeConfigDir,
              args.homeDir,
            ),
          },
  });
}
