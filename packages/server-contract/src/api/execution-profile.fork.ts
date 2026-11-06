import { z } from "zod";
import {
  reasoningLevelSchema,
  recordedThreadExecutionOptionsSchema,
  resolvedThreadExecutionOptionsSchema,
  threadExecutionReportSchema,
} from "@bb/domain";

export const threadExecutionProfileResponseSchema = z.object({
  lastRequested: recordedThreadExecutionOptionsSchema.nullable(),
  overrides: z.object({
    model: z.string().nullable(),
    reasoningLevel: reasoningLevelSchema.nullable(),
  }),
  nextTurn: resolvedThreadExecutionOptionsSchema.nullable(),
  executed: threadExecutionReportSchema
    .extend({ reportedAt: z.number().int() })
    .nullable(),
});
export type ThreadExecutionProfileResponse = z.infer<
  typeof threadExecutionProfileResponseSchema
>;
