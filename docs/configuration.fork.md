# Configuration (fork)

## Client SSH Targets

New subsection after "Client SSH Targets" and before "Provider availability":

### Run Command Gate

The `runCommandEnabled` key (default `on`) controls whether shell commands from
thread messages may be executed in your local terminal. Turning it off hides
the run button in the app and makes the local daemon reject run requests:

```bash
npx bb-app client run-command off
npx bb-app client run-command on
```

## Custom ACP Agents

Replaces the `customAgents` example line:

  {"id": "amp", "displayName": "Amp", "command": "amp", "args": ["acp"], "icon": "Sparkles"}

Replaces the line starting "own. Optional fields:":

own. Optional fields: `icon`, `args`, `env`, `cwd`, `modelCli` (CLI model listing and

New paragraph after the optional-fields list (after "`omp`, or `grok`)."):

`icon` accepts a host glyph such as `Sparkles`, an ACP provider mark
(`provider-acp/claude`, `provider-acp/glm`, `provider-acp/cursor`,
`provider-acp/opencode`, `provider-acp/omp`, `provider-acp/grok`, or
`provider-acp/hermes-agent`), or your own image: an absolute or `~/` path to an
`.svg`, `.png`, or `.webp` file of at most 32 KiB on the machine running the bb
server, or a `data:image/svg+xml;base64,...` (or `image/png`, `image/webp`) URI.
bb reads the file when the setting changes or bb starts, so save the setting
again after editing the file. The image is drawn as a single-color mask, like
the bundled marks. Saving the setting fails when the icon file is missing,
unreadable, or too large; if the file disappears later, the agent keeps its
default icon and bb logs a warning. If omitted for a replacement of a shipped agent, the
shipped icon is kept. Other custom agents use the Toolbox glyph by default.

## Custom Models

Replaces the first sentences of the `providerId` paragraph:

`providerId` accepts `codex`, `claude-code`, `pi`, `acp-cursor`, any `acp-*`
provider id, or a `claude-code-<id>` Claude Code profile id. `displayName` is
optional. bb skips an invalid entry with a warning. Entries appear after the provider's own catalog in the model picker

## UI preferences

Replaces the first sentence of the intro and the key table under "Sidebar preferences" (adds the `composer.provider` and `composer.quickReplies` keys; the fork heading is "UI preferences"):

Core sidebar, Info panel, and composer preferences live in a server-side keyed registry shared by every

| Key                           | Value                                                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidebar.threadListProvider`  | Plugin key or `__automatic__` (default): the first installed thread list plugin other than the bundled `thread-list/thread-list`, else the bundled one                             |
| `sidebar.navigationProvider`  | Plugin key or `__automatic__` (default): the first navigation from a plugin other than the bundled Navigation plugin, else its `navigation/rail`                                   |
| `sidebar.pluginPanelOrder`    | Navigation destination order                                                                                                                                                       |
| `sidebar.visiblePluginPanels` | Navigation destinations shown, or `null` for every destination                                                                                                                     |
| `sidebar.footerOrder`         | Footer action order                                                                                                                                                                |
| `sidebar.hiddenFooterItems`   | Footer actions moved into More                                                                                                                                                     |
| `composer.provider`           | Plugin key, or `__automatic__` (default): the first composer from a plugin you installed, then the bundled Composer plugin                                                         |
| `composer.quickReplies`       | Messages shown as buttons above the composer on an idle thread; pressing one sends it. Default `["continue"]`; up to 50 messages of up to 1,024 characters; `[]` hides the buttons |
| `threadContextCard.pinned`    | `true` (default) keeps a thread pane's thread context card open beside the transcript when the pane is wide enough; `false` opens it only from the header                          |
| `infoPanel.collapsedSections` | Collapsed thread Info panel sections (`commits`, `uncommittedChanges`, `childThreads`, `forks`, `threadStorage`, or `<pluginId>/<sectionId>`)                                      |

## Provider Turn Stall Watchdog

A background sweep watches every active provider turn for a stall: no provider
activity on the running operation for a configured time. Idle is measured on the
single active operation, from its last activity event. A turn that streams output
does not trip the watchdog. Pending active-turn interactions are excluded.

- Stage 1 (`providerTurnIdleNotifyMs`, default `21600000` = 6 hours): writes a
  "Provider turn stopped responding" marker into the thread timeline and, if the
  push-notifications plugin is enabled, sends an OS, desktop, or mobile
  notification. Notifications do not stop the turn.
- Stage 2 (`providerTurnIdleInterruptMs`, default `43200000` = 12 hours): writes
  the marker again, interrupts the stuck turn through the standard stop path
  (the same interrupt as `bb thread stop`, with reason "provider turn stopped
  responding"), and notifies again.

Settings (global, via `bb settings general <key> <value>`):

- `providerTurnIdleWatchdogEnabled` (default `true`) — set `false` to disable both
  stages entirely.
- `providerTurnIdleNotifyMs` (default `21600000`, i.e. 6h) — stage-1 idle
  threshold in milliseconds.
- `providerTurnIdleInterruptMs` (default `43200000`, i.e. 12h) — stage-2 idle
  threshold in milliseconds. Must be greater than `providerTurnIdleNotifyMs`.

Both thresholds have a floor of 5 minutes (`300000` ms), and the interrupt
threshold must remain greater than the notify threshold. The service runs a
sweep every `60000` ms and processes up to 25 actionable turns in each sweep.
Scheduler delays or a full batch can postpone an action beyond the next sweep.

Use the existing `bb settings general <key> <value>` command to update these
settings. If you raise the notify threshold past the current interrupt threshold,
raise the interrupt threshold first. If you lower the interrupt threshold below
the current notify threshold, lower the notify threshold first. The SDK uses the
existing general settings update.

## Plugins: Claude Code provider

New table row after the `fullAccessApprovalsEnabled` row:

| `profiles`                   | empty   | JSON array of `{id, displayName, configDir}` (login) or `{id, displayName, authTokenFile, env}` (token) entries; each registers a native `claude-code-<id>` provider (see below).                                                                                     |

Replaces the sentences "Two host-daemon environment variables reach the Claude Code bridge: `BB_CLAUDE_CODE_EXECUTABLE` picks the `claude` binary, and":

The Claude Code bridge inherits the host daemon's environment minus `BB_*`
variables. `BB_CLAUDE_CODE_EXECUTABLE` picks the `claude` binary, and
`CLAUDE_CODE_OAUTH_TOKEN` authenticates a machine with no interactive login,
such as a CI runner (mint it with `claude setup-token`). See the
`claude-code-provider` skill.

New paragraphs after the `CLAUDE_CODE_OAUTH_TOKEN` paragraph and before "Account Pooler":

`profiles` entries use an `id` of lowercase letters and digits joined by single
hyphens (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 41 characters), a `displayName`, and
a `configDir` (`~/<sub>` or an absolute canonical path: not the home directory
or the filesystem root `/`, no trailing `/`, empty segment, `.` or `..` segment,
no non-NFC Unicode or control/bidi/invisible characters, and none of `$` `` ` ``
`"` `'` `\` `!`). Profiles are macOS/Linux only (POSIX paths). Sign in with
`CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude auth login`. Login profile threads
use only that stored login: `ANTHROPIC_*` credential and base-URL variables, backend
switches (`CLAUDE_CODE_USE_*`), `CLAUDE_CODE_*` credential variables, and every
`CLAUDE_*` name ending in `_TOKEN`, `_TOKEN_FILE_DESCRIPTOR`, `_KEY`
(except `CLAUDE_CHROME_TAB_GROUP_KEY`, which is kept), `_PASSPHRASE`, `_SECRET`,
or `_SNAPSHOT_PATH` (plus the `CLAUDE_BG_AUTH_*`,
`CLAUDE_BRIDGE_*`, and account-identity variables) are stripped from the
profile bridge, except a model/display allowlist (including `ANTHROPIC_LOG`) and
a few non-routing `CLAUDE_CODE_USE_*` toggles. Proxy URL and switch variables
stay, but proxy auth tokens (`AGENT_PROXY_AUTH_TOKEN`) are stripped, as are
`AWS_BEARER_TOKEN_BEDROCK` and the `CCR_*` and `CLAUDE_RUNNER_*` account and
credential names. The stripping applies to tool subprocesses in profile
threads too, not only the SDK. Profiles
share the other settings above, and the CLI preflight is skipped for them, so
update the CLI through the default provider. The `claude-code-provider` skill
lists the exact variables and the caveats (changing `configDir` strands existing
threads; with Chrome on, a work profile drives the host's personal Chrome login).

A token profile (`{id, displayName, authTokenFile, env}`, exclusive with
`configDir`) sends the CLI to another Anthropic-compatible endpoint, such as
GLM on z.ai, with the API token read from `authTokenFile` (`~/<sub>` or an
absolute canonical path; a regular file owned by you, mode `600`, at most 4 KB,
one trailing newline trimmed). `env` is an allowlist: `ANTHROPIC_BASE_URL`
(required; `https:`, or `http:` only for `localhost`, `127.0.0.1`, `[::1]`; no
userinfo, query, or fragment), `ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`,
`ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL` (with `_NAME`,
`_DESCRIPTION`, `_SUPPORTED_CAPABILITIES`), `ANTHROPIC_CUSTOM_MODEL_OPTION` (with the
same three suffixes),
`API_TIMEOUT_MS`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and
`CLAUDE_CODE_AUTO_COMPACT_WINDOW`; credential keys are rejected, and at least
one model variable with a non-empty value is required. For example
`{"id":"glm","displayName":"GLM (native)","authTokenFile":"~/.config/bb/glm.token","env":{"ANTHROPIC_BASE_URL":"https://api.z.ai/api/anthropic","ANTHROPIC_DEFAULT_OPUS_MODEL":"glm-5.3[1m]","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.3-flashx[1m]","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-5.3-flash[1m]","API_TIMEOUT_MS":"3000000"}}`.
The token is read fresh for each session, model list, fork, health check, and
usage check, and
again whenever an existing thread's session restarts, so a rotated token reaches
existing threads on their next session start. A missing, empty, symlinked, or
group/other-accessible file fails closed before any CLI starts, so the host's
stored login is never sent to the base URL (`O_NOFOLLOW` covers the file itself;
a symlinked parent directory is not checked). Health is
`ready` when the file is valid (a revoked token shows `ready` until a turn fails
with 401); a base URL of `api.z.ai`, `open.bigmodel.cn`, or `dev.bigmodel.cn`
reports plan usage, and any other base URL reports none. Setting
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` in the profile `env` to any trimmed
value other than `0` or `false` (case-insensitive) turns usage off. Token profiles share `~/.claude` (they do not
set `CLAUDE_CONFIG_DIR`), so `~/.claude/settings.json` keys such as `model`, an
`env` block, and `apiKeyHelper` are read for GLM threads too. Of the auth and
routing keys, only `model` and unpinned `env` keys apply from that file: bb's
flag settings pin `apiKeyHelper`, the profile `env` keys, every credential and
backend-switch variable, and the proxy/TLS transport keys (which take their
values from that file's `env` first; `ANTHROPIC_UNIX_SOCKET` is always blank).
Hooks, permissions, MCP servers, plugins and `statusLine` apply as usual.
Repository settings cannot redirect or replace the token. For a z.ai/Zhipu
base URL, bb itself additionally sends the raw token to
`<base-origin>/api/monitor/usage/quota/limit` on each usage refresh: about
every 2 minutes while a usage view (sidebar card or composer aside) is visible,
plus on focus and when Settings → Provider usage opens. They offer no Auto mode or Fast tier; 1M context
comes from the `[1m]` model suffix. A token profile sends the whole conversation
(prompts, file contents read by tools, tool and Bash output), plus CLAUDE.md,
auto-memory, and bb's injected context, to the endpoint's operator;
`memoryEnabled` stops
auto-memory but is plugin-wide, so it also turns memory off for the default and
login profiles. Tool subprocesses in these threads can read
`ANTHROPIC_AUTH_TOKEN`.

## Plugins: Thread list plugin

The following text is retained from the local fork. This checkout has no named project-group implementation. These examples do not describe supported commands.

New table row after the `threadLifecycles` row:

| `projectGroups`       | `[]`                              | `{"id","name","projectIds"}` objects grouping projects when organized by project; see below                                                 |

New paragraph and code block after the paragraph on row actions, before "Connect and bb account":

When organized by project, a project's **Move to group** menu puts it in a
named group, creates a new group, or removes it from its group. Grouped
projects render together under a collapsible group header at the position of
the group's first project; drag a member to move the whole group. With
Alphabetical or Recent activity project sorting, groups sort by name or by
their most recent member activity. The group header's menu renames the group or
ungroups its projects. A group with no remaining projects is removed. Group ids
must be unique, names are trimmed and cannot be blank, and a project can belong
to only one group. `collapsedProjectGroups` lists collapsed group ids.

```sh
bb thread-list prefs get projectGroups --json
bb thread-list prefs set projectGroups '[{"id":"work","name":"Work","projectIds":["proj_a","proj_b"]}]'
bb thread-list prefs reset projectGroups
```
