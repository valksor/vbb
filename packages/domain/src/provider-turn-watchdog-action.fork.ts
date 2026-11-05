import { z } from "zod";

const providerTurnWatchdogActionValues = ["notify", "interrupt"] as const;
export const providerTurnWatchdogActionSchema = z.enum(
  providerTurnWatchdogActionValues,
);
export type ProviderTurnWatchdogAction = z.infer<
  typeof providerTurnWatchdogActionSchema
>;
