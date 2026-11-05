# Composer aside

Provider usage also appears beside an open thread composer. The aside shows the current thread and non-fork descendants, grouped as This thread and Subthreads. It reports provider and account quotas available to those hosts; it does not attribute usage to a specific thread or identify the account used for a turn.

The aside uses the existing authenticated, same-origin plugin RPC and the server aggregation and cache shared with the footer card. A normal request has this shape:

```json
{"force":false,"machineIds":["host-example","source:account-pool"],"providerIds":["codex"],"maxAgeMs":120000}
```

The request contains only `force`, `machineIds`, `providerIds`, and `maxAgeMs`. It sends no prompt, transcript, credential, token, or profile configuration. Server responses can include source metadata beyond the resources measured by the request. This selection is not access control or strict metadata minimization. Email remains in RPC data and screen-reader descriptions, while visible window rows omit it.

Mounted panes debounce for 300 ms and union their provider IDs per host or source. Automatic requests use `force: false` and `maxAgeMs: 120000`. While the document is visible, the aside checks every minute, refreshes after two minutes or a due focus event, and refreshes once after a reported reset plus 60 seconds with `maxAgeMs: 0`. Request and machine failures back off for five minutes. Failed refreshes retain successful rows, and unavailable usage is not shown as zero.

Enabled Provider usage installations receive the aside automatically. There is no separate aside toggle. Disabling the plugin removes its displays; hiding the footer shortcut does not disable the aside. The host hides the aside below approximately 1240 px without unmounting it, so narrow panes can still refresh.

The existing generic SDK and CLI expose measurements, not the aside's grouped UI. Call the existing RPC with:

```sh
bb plugin rpc call bb--provider-usage getUsage --input-file /path/to/usage-request.json --json
```

`bb settings usage --machine <host> --json` and `sdk.system.usageLimits()` remain host-local. Neither aggregates pooled accounts. This feature adds no command, flag, setting, plugin API, authentication, session, database, server or daemon wire, or RPC-schema change.

The unit and DOM tests cover registration, grouping, pooling, request scope, caching, failure handling, cadence, reset scheduling, and cleanup. Browser, responsive-layout, and iOS verification are not covered by those tests or by bundling.
