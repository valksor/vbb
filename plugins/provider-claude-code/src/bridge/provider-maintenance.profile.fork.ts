import type { ProviderHealthResult } from "@get-bb/plugin-sdk/provider-bridge";
import type { ActiveTokenProfile } from "./profile-env.js";
import { readProfileToken } from "./profile-token.js";

type HealthResultBuilder = (
  status: "ready" | "unauthenticated",
  args: {
    installedVersion: string | null;
    loginCommand: null;
    statusMessage: string;
  },
) => ProviderHealthResult;

export function tokenProfileHealth(
  profile: ActiveTokenProfile,
  installedVersion: string | null,
  healthResult: HealthResultBuilder,
): ProviderHealthResult {
  try {
    readProfileToken(profile.authTokenFile);
    return healthResult("ready", {
      installedVersion,
      loginCommand: null,
      statusMessage: `Using the API token in ${profile.authTokenFile}.`,
    });
  } catch (error) {
    return healthResult("unauthenticated", {
      installedVersion,
      loginCommand: null,
      statusMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
