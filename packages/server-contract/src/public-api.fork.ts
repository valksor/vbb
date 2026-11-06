import {
  defineRoute,
  jsonResponse,
  noRequest,
  optionalQueryRequest,
  type EmptyInput,
} from "@bb/hono-typed-routes";
import {
  backgroundTaskOutputQuerySchema,
  type BackgroundTaskOutputQuery,
  type BackgroundTaskOutputResponse,
} from "./api/background-task-output.js";
import {
  spendRollupQuerySchema,
  type SpendBackfillResponse,
  type SpendRollupQuery,
  type SpendRollupResponse,
} from "./api/spend.js";
import type { ThreadExecutionProfileResponse } from "./api/execution-profile.fork.js";
import type { PathId } from "./common.js";
import { branchPromotionRoutes } from "./branch-promotion-routes.fork.js";

type PathThreadBackgroundTask = { param: { id: string; itemId: string } };

export const forkThreadRoutes = {
  ...branchPromotionRoutes,
  backgroundTaskOutput: defineRoute({
    path: "/threads/:id/background-tasks/:itemId/output",
    method: "get",
    request: optionalQueryRequest<
      PathThreadBackgroundTask,
      BackgroundTaskOutputQuery
    >(backgroundTaskOutputQuerySchema),
    response: jsonResponse<BackgroundTaskOutputResponse>(),
  }),
  executionProfile: defineRoute({
    path: "/threads/:id/execution-profile",
    method: "get",
    request: noRequest<PathId>(),
    response: jsonResponse<ThreadExecutionProfileResponse>(),
  }),
};

export const forkTopLevelRoutes = {
  spend: {
    rollup: defineRoute({
      path: "/spend/rollup",
      method: "get",
      request: optionalQueryRequest<EmptyInput, SpendRollupQuery>(
        spendRollupQuerySchema,
      ),
      response: jsonResponse<SpendRollupResponse>(),
    }),
    backfill: defineRoute({
      path: "/spend/backfill",
      method: "post",
      request: noRequest(),
      response: jsonResponse<SpendBackfillResponse>(),
    }),
  },
};
