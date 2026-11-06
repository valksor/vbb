# API audit list (fork)

Fork entries for `api_to_audit.md`. Each heading names the upstream section the text belongs to; sections without an upstream counterpart sit at the position noted.

## `bb.ui.requestInput` `experimental_holdToolCall`

`bb.ui.requestInput`'s options accept an optional `experimental_holdToolCall`
boolean. Default (`false`/absent) keeps today's behavior: inside a native tool's
`execute`, the tool call is detached and answered at once with a waiting notice,
and the eventual result reaches the agent as a later message. When set, the tool
call instead stays blocked until the form settles, and the interaction is bound
to the thread's active turn (`turnId` is populated from the active turn), so the
turn-bound send/steer/dispatch guards treat the thread as busy and reject a send
until the form resolves — matching a provider's native question. Used by the
bundled `ask-user-question` plugin so an unanswered question halts the turn
rather than letting the agent proceed.

Before stabilizing: audit the held-open tool-call transport (a blocking form can
hold the daemon→server request open up to the form timeout; forwarded tool calls
use a 65-minute transport ceiling), the turn-bound interaction lifecycle
(steer/edit/queue while pending, and abort on thread stop/delete, plugin dispose,
session revocation, and server-move), and concurrency (the
one-active-interaction-per-thread guard is the only cap on held-open calls).
Decide whether turn-binding should be inferred from the renderer/policy on the
server rather than carried as a public option.

Placement: before "## `app.commands.register`".

## `bb.ui.requestInput` `experimental_requireAppAnswer`

**What it does.** `bb.ui.requestInput`'s options accept an optional
`experimental_requireAppAnswer` boolean. Default (`false`/absent) keeps today's
behavior: any caller of `POST /threads/:id/interactions/:interactionId/respond`
can answer the form. When set, the server refuses an answer unless the request
carries an app surface in `x-bb-app-surface` (`desktop`, `web` or `mobile`).
A missing, `api` or unknown value counts as `api` and gets
`403 app_answer_required` ("This form must be answered in the bb app."); the form
stays pending, so a later app answer succeeds, and the server logs a warning
with the thread id and interaction id and no payload. The check runs after the
waiter lookup and before the already-submitting check, so a refused caller never
sees `409`. The flag lives on the in-memory plugin waiter only: after a server
restart the form has no waiter, and the respond route cancels it as it does for
any waiter-less form, so nothing is credited.

Every live answer to a plugin form records `answeredVia: "app" | "api"` on its
`plugin_submitted` resolution. It is absent on late-answer recoveries and on
resolutions stored before this field existed, where it means the origin was not
recorded. `HOST_DAEMON_PROTOCOL_VERSION` is not bumped: the resolution union is
also the `resolution` of the `interactive.resolve` host command, but
`plugin_submitted` never crosses that wire (provider plugin-extension forms resolve with
`request_answer`), and the nested object is not strict, so an older daemon drops
the key. Host-daemon-contract tests check the new parser and the pinned previous
plugin-resolution parser, including removal of the new optional key by the previous parser.

**Who uses it.** No bundled core caller uses this option. A plugin can apply it
to its approval forms. The option does not establish who answered.

**Deliberate exception.** This is an exception to the `AGENTS.md` rule that every
end-user feature is usable through the SDK and `bb` CLI: `bb thread interactions
respond` is refused on a flagged form by design. The CLI needs no change; it
prints the 403 message and exits non-zero.

**Limits (deterrent only).** The local API authenticates nobody, and
`x-bb-app-surface` is a self-declared telemetry header. A `curl` that sends the
header, or an agent that drives the real app through browser automation, still
answers the form. Native plan approvals (Claude Code's ExitPlanMode card) are not
covered: `bb thread interactions approve <id> --self` still resolves them.

Before stabilizing: a real resolver identity in core (who answered, not which
client claimed to) replaces the header, and the option is then either dropped or
re-expressed as "requires a human identity". Audit whether `answeredVia` should
become a resolver identity on every resolution kind, and whether other
interaction kinds need the same gate.

## `experimental_thread.turnWatchdog` (`PluginThreadEventPayloads`)

**What it does.** Core produces this event in `runProviderTurnWatchdogSweep` when
the watchdog acts on the active turn. `action: "notify"` fires when idle time first crosses
`providerTurnIdleNotifyMs` and the turn is still running. `action: "interrupt"`
fires when the turn crosses `providerTurnIdleInterruptMs`. Core emits it before
requesting the stop, so the payload thread status is still `active`. The
push-notifications plugin consumes this event. The payload includes the standard
`ThreadResponse` DTO, which can contain a user-written title or fallback, plus
`elapsedMs`, `thresholdMs`, and `action`. The additional watchdog fields contain
no prompt or output snapshots. Consumers must apply their existing privacy policy
before forwarding the DTO.

**Docs.** [Backend events](../plugins/bb-guide/skills/bb-plugin-authoring/references/backend-events.md).

**Audit before stabilizing.** Confirm the payload answers what a notifier needs
without replaying the event log. Decide whether `notify` and `interrupt` should
stay one event with an `action` discriminant or split into two named events.
Confirm consumers apply their privacy policy before forwarding the `ThreadResponse`
DTO. Stabilization includes the project-wide rename and removing this entry.

## `experimental_nativeRootsHostContract` (`@get-bb/plugin-sdk/host`)

Replaces the input description ("Input is `{ providerId, cwd: string | null }`. Output is `{ skills, commands }`, each a") in the entry for the one-method host RPC contract (`resolveNativeRoots`):

`{ providerId, cwd: string | null, bridgeOptions? }`; `bridgeOptions` is the
provider's registered `experimental_bridgeOptions`, sent only when non-empty,
so a plugin that registers several providers from one host entry (the Claude
Code profiles) can resolve each provider's own roots. Compatibility limit: the
server sends `bridgeOptions` whenever a provider declares non-empty
`experimental_bridgeOptions` (ACP providers always do). A third-party resolver
bundled with an older SDK whose input schema is strict rejects that input, and
the server falls back to the declared roots with a warning. Output is `{ skills, commands }`, each a

## `bb.sdk.threads.experimental_backgroundTaskOutput`

**What it does.** `GET /threads/:id/background-tasks/:itemId/output` returns `{ state, text, truncated, totalBytes }` for a `local_bash` background command: the tail (default 64 KiB, at most 1 MiB, `tailBytes`) of the task's output file, read through the host daemon with a size read followed by a tail read, retried with backoff on `file_changed`. `state` is `available`, `pending` (file not yet created while the task runs), `busy` (the file kept changing), or `unavailable` (not a trusted `local_bash` task of that thread, no host or environment, a daemon file error, or the file is gone after the task ended). The core SDK takes `{ threadId, itemId, tailBytes?, signal? }`. The server only reads the `claude-<uid>/…/tasks/<familyId>.output` path it recorded from the task's own events, never a caller-supplied path, and never returns the host path.

**Core callers.** The command-output panel on the background-commands banner (`useThreadBackgroundTaskOutput`) and `bb thread background --task`.

**Stabilization criteria.** Decide whether other providers' background tasks should be readable, whether `tailBytes` and the `busy`/`pending` states belong in the stable contract, and whether output should stream instead of being polled. Then run the audit, rename project-wide, and remove this entry.

## `bb.providers.register` (`experimental_bridgeOptions`, `experimental_visibility`, and the `experimental_providerBridge` artifact export)

New text after "every bridge launch as provider-scoped static options.":

The Claude Code plugin is a second consumer: its profiles use it for
plugin-owned profile config beyond launch metadata, either `{ claudeConfigDir }`
(a login profile) or `{ claudeAuthTokenFile, claudeEnv }` (a token profile). The
bridge re-validates both shapes with the same rule helpers as the plugin's
settings schema, and a token profile carries only the token file's path and an
allowlisted env, never the token. Weigh this use when deciding whether static
options survive beside `deriveProviderOptions`.

Replaces the first lines of audit item 2 in the same entry:

2. **Icon URL shape.** A path, a declared icon, or a base64
   `data:image/{svg+xml,png,webp}` URI of at most 32 KiB (artwork a plugin reads
   at runtime, such as the ACP plugin's user-chosen icon files) is snapshotted
   at registration and served from `/api/v1/system/providers/<id>/logo`; a host glyph name

## `experimental_useSidebarThreads` / `experimental_useSidebarThreadActions` (`@get-bb/plugin-sdk/app`)

Replaces the sentence "**Kept experimental (2026-08-22).** There are no consumers. Items 4 (a":

**Kept experimental (2026-08-22).** No consumers at the audit; the read hook
has had them since 2026-09-04 (provider-usage) and 2026-09-21 (thread-list's
`use-sidebar-data`). Thread-list became the first in-repo consumer of the
`indicator` field in the 2026-10-21 waiting-kind split (below). Items 4 (a

New paragraph after the audit item that ends "documented "treat unknown as none" rule is enough." and before item 3 ("Unread semantics."):

   **2026-10-21.** The first kind split shipped under this rule. Degradation
   by plugin: one that forwards `thread.indicator` to
   `experimental_ThreadStatusGlyph` gets the new icons unchanged; one that
   hand-rolls a glyph switch on `indicator` draws nothing for the two new
   kinds until it adopts the `waiting-for-*` → `waiting-for-input` fallback;
   an un-rebased thread-list fork that resolves from `hasPendingInteraction`
   keeps the generic glyph. The gap is accepted knowingly, and the
   `waiting-for-*` prefix fallback is the mitigation for future kind splits.
   Thread-list became the first in-repo consumer of the `indicator` field in
   this change.

## `app.slots.experimental_threadInfoRow` / `app.slots.experimental_threadInfoSection` (and related Info-list members)

Replaces the line "Docs: `frontend-registration.md`, `frontend-components.md`.":

Docs: `frontend-thread-slots.md`, `frontend-components.md`.

## `app.slots.experimental_composerAside` (`@get-bb/plugin-sdk/app`)

Renders a plugin component in the gutter to the right of an open thread's
composer, once per pane with that pane's `threadId`. Registration is
`{ id, title, component }`. The host wraps the component in one region
landmark named with `title`, sized to the gutter: the width is the space right
of the thread column minus the table-of-contents reserve, at most 18rem; the
height is capped (`max-h-48`) and scrolls (`overflow-y-auto`). The region is
hidden when that space is narrower than about 15rem — a pane narrower than
about 1240px. A mount whose output has no element child (null or text-only)
gets `hidden`, so no empty landmark is exposed, and one that scrolls gains a
tab stop so keyboard users can reach the overflow. A crash removes only that
pane's copy.

**Core callers.** None: the slot is render-only and performs no core action.

Docs: `frontend-registration.md`.

**Audit before stabilizing.**

1. **Budget and height.** The cap is 18rem wide and `max-h-48` tall. Decide
   whether that survives three plugins registering, and whether the host needs
   an overflow rule across slots instead of per-slot scrolling.
2. **TOC coexistence.** The width reserves 3.5rem for the table-of-contents
   rail and its padding. Confirm the reserve still matches the rail after any
   rail resize, and that the aside never sits under it.
3. **Left vs right gutter.** The aside only hangs right of the column. Decide
   whether a left placement or a column-side choice belongs in the contract.
4. **Other composers.** The slot is only on the thread-detail composer.
   Decide whether the root compose screen, plugin panels, and embedded chats
   want the same slot or stay host-only.
5. **Per-pane mounting.** Confirm plugins handle mounting once per pane with
   their own `threadId`, and that a crash in one pane cannot disable
   another's copy.

## `PluginSidebarThread.pendingInteractionKind` / `PluginThreadStatusThread.pendingInteractionKind` (`@get-bb/plugin-sdk/app`)

**What it does.** Both thread types carry the kind of the thread's pending
interaction (`ThreadPendingInteractionKind | null`; `null` when nothing is
pending). `experimental_resolveThreadStatus` maps it to two extra
`PluginSidebarThreadIndicator` values: `waiting-for-plan-approval` for
`plan_approval` and `waiting-for-answer` for `question`. Any other kind gives
`waiting-for-input`. For a collapsed group, the indicator uses the kind that
the thread and all its pending hidden threads share; mixed kinds give
`waiting-for-input`. Core's sidebar glyph and the `thread-list` plugin use the
same resolver.

**Audit before stabilizing.** The field is required, so a plugin that builds
these objects itself must set it (`null` is valid). Objects from a plugin built
against an older SDK omit it, and the resolver treats that as
`waiting-for-input`. Decide whether the field becomes optional or
`experimental_`-prefixed before it goes upstream, and whether other interaction
kinds need their own indicator.
