Maintenance commands

Maintenance is a local-only operational surface on `<BB_DATA_DIR>/admin/maintenance.sock`; it is not reachable through the TCP server, BB Connect, or a browser SDK. Protocol `2` identity reports the runtime and connected host daemons used for barrier checks. Keep the capability and operation owner files local with mode `0600`.

  bb maintenance identity                 Verify the local admin protocol
  bb maintenance status                   Show lease, daemon barriers, and work
  bb maintenance acquire --reason <text>  Acquire admission and daemon barriers
    --ttl-ms <30000-1800000>              Default 300000 milliseconds
    --operation-id <id>                   Retry a caller-generated operation
  bb maintenance renew <id>               Renew a draining lease
  bb maintenance seal <id>                Enter fail-closed restart state
    --candidate <identity> --previous <identity>
    --allow-active-work                   Break-glass active-work acceptance
  bb maintenance transition <id> <expected-phase> <phase>
  bb maintenance release <id> --resolution <completed|rolled-back|force-aborted>
  bb maintenance recover <id>             Abort draining, sealing, or rollback-failed

All commands accept `--data-dir <absolute-path>` and `--json`. Acquire writes a restrictive owner file under `<BB_DATA_DIR>/admin/operations/`. `BB_MAINTENANCE_OWNER_SECRET` overrides the generated local owner secret. While a lease is held, direct starts return `work_quiesced`; queued and automatic work is held and replayed on release. Draining expiry reopens admission. CLI recovery force-aborts only draining, sealing, or rollback-failed leases.

Node callers use `createNodeAdminClient` from `@bb/sdk/node-admin` or `@bb/sdk/node`. The local paths are `<BB_DATA_DIR>/admin/maintenance.sock`, `<BB_DATA_DIR>/admin/capability`, and `<BB_DATA_DIR>/admin/operations/<id>.json`.
