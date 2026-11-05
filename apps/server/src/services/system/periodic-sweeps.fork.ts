import { runProviderTurnWatchdogSweep } from "../threads/provider-turn-watchdog.js";
import type { PeriodicSweepJob } from "./periodic-sweeps.js";

export const FORK_PERIODIC_SWEEP_JOBS: PeriodicSweepJob[] = [
  {
    cadenceMs: 60_000,
    category: "maintenance",
    name: "provider-turn-idle-watchdog",
    run: (deps, now) => {
      runProviderTurnWatchdogSweep(deps, { now });
    },
  },
];
