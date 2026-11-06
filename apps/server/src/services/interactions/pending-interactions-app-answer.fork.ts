import { parseRequestAppSurface } from "@bb/config/app-surface";
import type { PluginPendingInteraction } from "@bb/domain";
import { ApiError } from "../../errors.js";
import type { ServerLogger } from "../../types.js";

export type PluginAnswerOrigin = "app" | "api";

export function pluginAnswerOrigin(
  appSurfaceHeader: string | undefined,
): PluginAnswerOrigin {
  const surface = parseRequestAppSurface(appSurfaceHeader);
  return surface === undefined || surface === "api" ? "api" : "app";
}

export function assertPluginAnswerOriginAllowed(
  host: { logger: ServerLogger },
  args: {
    interaction: PluginPendingInteraction;
    requireAppAnswer: boolean;
    answeredVia: PluginAnswerOrigin;
  },
): void {
  if (!args.requireAppAnswer || args.answeredVia === "app") return;
  host.logger.warn(
    { threadId: args.interaction.threadId, interactionId: args.interaction.id },
    "Refused a plugin interaction answer that did not come from the bb app",
  );
  throw new ApiError(
    403,
    "app_answer_required",
    "This form must be answered in the bb app.",
  );
}
