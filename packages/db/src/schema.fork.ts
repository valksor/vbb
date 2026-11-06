import { sql } from "drizzle-orm";
import type {
  BranchPromotionIntent,
  BranchPromotionSnapshot,
} from "@bb/domain/branch-promotion";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const branchPromotions = sqliteTable(
  "branch_promotions",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    environmentId: text("environment_id").notNull(),
    hostId: text("host_id").notNull(),
    path: text("path").notNull(),
    phase: text("phase", {
      enum: ["prepared", "running", "reconciling", "completed", "failed"],
    }).notNull(),
    intent: text("intent", { mode: "json" })
      .$type<BranchPromotionIntent>()
      .notNull(),
    snapshot: text("snapshot", {
      mode: "json",
    }).$type<BranchPromotionSnapshot>(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    settledAt: integer("settled_at"),
  },
  (table) => [
    uniqueIndex("branch_promotions_active_thread_idx")
      .on(table.threadId)
      .where(sql`${table.settledAt} is null`),
    uniqueIndex("branch_promotions_active_environment_idx")
      .on(table.environmentId)
      .where(sql`${table.settledAt} is null`),
    index("branch_promotions_thread_created_idx").on(
      table.threadId,
      table.createdAt,
    ),
  ],
);
