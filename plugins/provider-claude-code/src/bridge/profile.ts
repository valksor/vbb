import {
  applyProfileEnv,
  applyProfileSessionEnv,
  type ActiveProfile,
} from "./profile-env.js";

let activeProfile: ActiveProfile | null = null;

export function noteProfileRequest(params: unknown): void {
  activeProfile = applyProfileEnv(process.env, activeProfile, params);
}

export function currentProfile(): ActiveProfile | null {
  return activeProfile;
}

export function applyActiveProfileSessionEnv(
  sessionEnv: NodeJS.ProcessEnv,
): void {
  applyProfileSessionEnv(sessionEnv, activeProfile);
}
