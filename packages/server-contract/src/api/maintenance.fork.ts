import { z } from "zod";

export const maintenanceLeasePhaseSchema = z.enum([
  "draining",
  "sealing",
  "sealed",
  "activating",
  "verifying",
  "rolling-back",
  "rollback-failed",
  "releasing",
]);

export const maintenanceLeaseSchema = z.object({
  operationId: z.string().min(1),
  reason: z.string().min(1),
  phase: maintenanceLeasePhaseSchema,
  acquiredAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative().nullable(),
  candidateRelease: z.string().min(1).nullable(),
  previousRelease: z.string().min(1).nullable(),
});
export type MaintenanceLease = z.infer<typeof maintenanceLeaseSchema>;

export const maintenanceBarrierHostSchema = z.object({
  hostId: z.string().min(1),
  state: z.enum(["pending", "quiesced", "sealed", "released", "failed"]),
  error: z.string().min(1).nullable(),
});
export type MaintenanceBarrierHost = z.infer<
  typeof maintenanceBarrierHostSchema
>;

export const maintenanceActivitySchema = z.object({
  activeByKind: z.record(z.string().min(1), z.number().int().nonnegative()),
});
export type MaintenanceActivity = z.infer<typeof maintenanceActivitySchema>;

export const maintenanceStatusResponseSchema = z.object({
  lease: maintenanceLeaseSchema.nullable(),
  barrier: z.array(maintenanceBarrierHostSchema),
  activity: maintenanceActivitySchema,
});
export type MaintenanceStatusResponse = z.infer<
  typeof maintenanceStatusResponseSchema
>;

export const maintenanceAcquireRequestSchema = z.object({
  operationId: z.string().min(1),
  ownerSecret: z.string().min(1),
  reason: z.string().min(1).max(512),
  ttlMs: z.number().int().min(30_000).max(1_800_000),
});
export type MaintenanceAcquireRequest = z.infer<
  typeof maintenanceAcquireRequestSchema
>;

export const maintenanceOwnedRequestSchema = z.object({
  operationId: z.string().min(1),
  ownerSecret: z.string().min(1),
});
export type MaintenanceOwnedRequest = z.infer<
  typeof maintenanceOwnedRequestSchema
>;

export const maintenanceSealRequestSchema =
  maintenanceOwnedRequestSchema.extend({
    candidateRelease: z.string().min(1),
    previousRelease: z.string().min(1),
    allowActiveWork: z.boolean(),
  });
export type MaintenanceSealRequest = z.infer<
  typeof maintenanceSealRequestSchema
>;

export const maintenanceTransitionRequestSchema =
  maintenanceOwnedRequestSchema.extend({
    expectedPhase: maintenanceLeasePhaseSchema,
    phase: maintenanceLeasePhaseSchema,
  });
export type MaintenanceTransitionRequest = z.infer<
  typeof maintenanceTransitionRequestSchema
>;

export const maintenanceReleaseRequestSchema =
  maintenanceOwnedRequestSchema.extend({
    resolution: z.enum(["completed", "rolled-back", "force-aborted"]),
  });
export type MaintenanceReleaseRequest = z.infer<
  typeof maintenanceReleaseRequestSchema
>;

export const maintenanceAcquireResponseSchema =
  maintenanceStatusResponseSchema.extend({ replayed: z.boolean() });
export type MaintenanceAcquireResponse = z.infer<
  typeof maintenanceAcquireResponseSchema
>;

export const maintenanceIdentityResponseSchema = z.object({
  service: z.literal("bb-maintenance"),
  protocolVersion: z.literal(2),
  releaseIdentity: z.string().min(1),
  connectedHostIds: z.array(z.string().min(1)),
});
export type MaintenanceIdentityResponse = z.infer<
  typeof maintenanceIdentityResponseSchema
>;
