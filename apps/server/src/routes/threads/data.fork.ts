import { getThreadExecutionOverride, getThreadExecutionReport } from "@bb/db";
import {
  BACKGROUND_TASK_OUTPUT_DEFAULT_TAIL_BYTES,
  BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES,
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type ThreadExecutionProfileResponse,
} from "@bb/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../../errors.js";
import { parseBoundedPositiveOptionalInteger } from "../../services/lib/validation.js";
import { requirePublicThread } from "../../services/lib/entity-lookup.js";
import { readThreadBackgroundTaskOutput } from "../../services/threads/background-task-output.js";
import { getLastExecutionOptions } from "../../services/threads/thread-events.js";
import { tryResolveExistingThreadExecutionPlan } from "../../services/threads/thread-execution-plan.js";
import type { AppDeps } from "../../types.js";

export function registerForkThreadDataRoutes(app: Hono, deps: AppDeps): void {
  const { get } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });
  const routes = publicApiRoutes.threads;

  get(routes.backgroundTaskOutput, async (context, query) => {
    const thread = requirePublicThread(deps.db, context.req.param("id"));
    const tailBytes = parseBoundedPositiveOptionalInteger({
      defaultValue: BACKGROUND_TASK_OUTPUT_DEFAULT_TAIL_BYTES,
      max: BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES,
      name: "tailBytes",
      value: query.tailBytes,
    });
    return context.json(
      await readThreadBackgroundTaskOutput(deps, {
        threadId: thread.id,
        itemId: context.req.param("itemId"),
        tailBytes,
      }),
    );
  });

  get(routes.executionProfile, async (context) => {
    const threadId = context.req.param("id");
    requirePublicThread(deps.db, threadId);
    const overrides = getThreadExecutionOverride(deps.db, threadId);
    const nextTurn =
      (
        await tryResolveExistingThreadExecutionPlan(deps, {
          executionSource: "client/turn/requested",
          input: {},
          threadId,
        })
      )?.resolvedExecution ?? null;
    const response: ThreadExecutionProfileResponse = {
      lastRequested: getLastExecutionOptions(deps, threadId),
      overrides: {
        model: overrides?.modelOverride ?? null,
        reasoningLevel: overrides?.reasoningLevelOverride ?? null,
      },
      nextTurn,
      executed: getThreadExecutionReport(deps.db, threadId),
    };
    return context.json(response);
  });
}
