import { z } from "zod";

export const BACKGROUND_TASK_OUTPUT_DEFAULT_TAIL_BYTES = 64 * 1024;
export const BACKGROUND_TASK_OUTPUT_MAX_TAIL_BYTES = 1024 * 1024;

export const backgroundTaskOutputQuerySchema = z.object({
  tailBytes: z.string().regex(/^\d+$/).optional(),
});
export type BackgroundTaskOutputQuery = z.infer<
  typeof backgroundTaskOutputQuerySchema
>;

export const backgroundTaskOutputResponseSchema = z.object({
  state: z.enum(["pending", "available", "busy", "unavailable"]),
  text: z.string(),
  truncated: z.boolean(),
  totalBytes: z.number().int().nonnegative(),
});
export type BackgroundTaskOutputResponse = z.infer<
  typeof backgroundTaskOutputResponseSchema
>;
