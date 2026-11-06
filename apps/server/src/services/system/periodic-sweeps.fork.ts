import { runProviderTurnWatchdogSweep } from "../threads/provider-turn-watchdog.js";
import { reconcileBranchPromotions } from "../threads/thread-environment-branch.fork.js";
import type { PeriodicSweepJob } from "./periodic-sweeps.js";

export const FORK_PERIODIC_SWEEP_JOBS: PeriodicSweepJob[] = [
  {
    cadenceMs: 15_000,
    category: "durable-intent-retry",
    name: "branch-promotion-reconciliation",
    run: reconcileBranchPromotions,
  },
  {
    cadenceMs: 60_000,
    category: "maintenance",
    name: "provider-turn-idle-watchdog",
    run: (deps, now) => {
      runProviderTurnWatchdogSweep(deps, { now });
    },
  },
];
