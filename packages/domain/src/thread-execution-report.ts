import { z } from "zod";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
} from "./shared-types.js";

export const threadExecutionReportSchema = z.object({
  model: z.string().min(1),
  reasoningLevel: reasoningLevelSchema.nullable(),
  permissionMode: permissionModeSchema.nullable(),
  serviceTier: serviceTierSchema.nullable(),
});
export type ThreadExecutionReport = z.infer<typeof threadExecutionReportSchema>;
