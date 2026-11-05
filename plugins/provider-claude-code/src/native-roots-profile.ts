import type { ExperimentalVendorPluginRoots } from "@get-bb/plugin-sdk/host";
import { z } from "zod";
import { parseClaudeConfigDir } from "./config-dir.js";
import { resolveClaudeNativeRoots } from "./native-roots.js";

const claudeBridgeOptionsSchema = z.object({
  claudeConfigDir: z.string().optional(),
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
  const { claudeConfigDir } = claudeBridgeOptionsSchema.parse(
    args.bridgeOptions ?? {},
  );
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
