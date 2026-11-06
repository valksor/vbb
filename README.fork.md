# vbb fork maintenance

Desktop updater and deployment usage remain pending Slice 07, Slice 08, and
Slice 22. Those slices are required migration work, not excluded functionality.

## Rebase on upstream

Fork changes live in new files so that upstream files keep only small hooks:

- Fork logic goes in a sibling `<name>.fork.<ext>` file. The upstream file keeps
  an import plus one call, registration, or spread.
- Fork tests go in `<name>.fork.test.<ext>` files.
- Fork documentation goes in `<name>.fork.md` files, with one pointer line in
  the upstream document. `CHANGELOG.md` stays equal to upstream; fork entries
  are in `CHANGELOG.fork.md`.

After every integration of `_get-bb/main`:

1. Fetch `_get-bb`, commit the integration result, then run
   `pnpm fork:footprint --budget 6000`. The command counts committed lines that
   differ from the merge-base of `HEAD` and `_get-bb/main`; uncommitted changes
   are not counted. Use `--base <upstream commit>` for an explicit immutable
   get-bb pin. Exit code 1 means the fork exceeds the budget, so move fork logic
   behind a seam. Exit code 2 means the command could not run because arguments,
   `scripts/fork-copies.json`, or `_get-bb/main` are invalid.
2. Read the copy-drift report printed by that command. It lists upstream commits
   for `plugins/tasks`, `plugins/thread-list`, and `plugins/github` since
   their bases in `scripts/fork-copies.json`. Port required fixes to the
   bb-plugins copies, then update the bases only after those fixes are applied.
3. Preserve public vbb's monotonic wire generation, including protocol 267. An
   unchanged wire contract keeps 267. When a contract changes or an imported
   generation collides, allocate
   `max(previous published vbb generation, imported get-bb generation) + 1`.
   Never mechanically replace public vbb's generation with get-bb plus one or
   downgrade it.
4. The private `lettland/bb` rebase rule uses `vbb/main` and allocates the
   private marker above the public vbb generation, without reusing or lowering a
   published private generation. It does not change public vbb to 268 during
   this migration.
5. Regenerate `pnpm-lock.yaml`,
   `apps/mobile/src/theme/theme.native.ts`, and
   `packages/provider-bridge-protocol/recordings/row-counts.json` instead of
   merging them by hand.

After every bb update, run `bb plugin list` and confirm the built-in
`tasks`, `thread-list`, and `github` plugins remain disabled so their
bb-plugins copies provide `bb tasks` and `bb thread-list`.
