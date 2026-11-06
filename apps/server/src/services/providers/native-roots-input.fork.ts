import type { ProviderRegistration } from "./provider-registry.js";

export function nativeRootsInput(
  providerId: string,
  cwd: string | null,
  registration: Pick<ProviderRegistration, "bridgeOptions">,
) {
  return {
    providerId,
    cwd,
    ...(Object.keys(registration.bridgeOptions).length > 0
      ? { bridgeOptions: registration.bridgeOptions }
      : {}),
  };
}
