---
name: claude-code-provider
description: "Configure or troubleshoot BB-specific Claude Code provider settings and session behavior."
---

# Claude Code provider

Read settings with `bb plugin config provider-claude-code`; change a declared key
with `bb plugin config provider-claude-code set <key> <value>`.

- `subagentsDisabled` defaults to `false`. Enable with
  `bb plugin config provider-claude-code set subagentsDisabled true` to remove
  native Agent, Task, and ListAgents tools from the model context. Changes
  restart Claude before the next turn, preserving the conversation. A deny hook
  also blocks native delegation during an active turn after disabling it.
- `disable1MContext` defaults to `false`. Enable with
  `bb plugin config provider-claude-code set disable1MContext true` to set
  `CLAUDE_CODE_DISABLE_1M_CONTEXT=1` (`0` when off). Changes restart the
  thread's Claude process before its next turn, preserving context.
- `chromeEnabled` defaults to `false`. It starts Claude Code with `--chrome` for
  Claude in Chrome tools. The host needs the extension and a claude.ai login.
  A change restarts the thread's Claude process before its next turn, preserving
  context.
- `artifactsEnabled` defaults to `false`. Enable with
  `bb plugin config provider-claude-code set artifactsEnabled true` to set
  `CLAUDE_CODE_ARTIFACT=1`, which gives threads Claude Code's `Artifact`,
  `ArtifactComments`, and `ArtifactData` tools for reading `claude.ai/artifact/`
  links and publishing pages. Claude Code withholds them from SDK sessions
  unless opted in. Claude may publish private pages to claude.ai without asking.
  The claude.ai account's plan and organization policy still decide whether the
  tools load. When off, bb leaves an inherited `CLAUDE_CODE_ARTIFACT` (shell,
  environment, or `~/.claude/settings.json` `env`) untouched. A change restarts
  the thread's Claude process before its next turn, preserving context.
- Select the Fast service tier in the model picker or pass `--service-tier fast`
  to `bb thread spawn` for supported Opus models. Use
  `bb thread tell --service-tier fast` to change a thread on its next turn;
  `default` turns it off. Fast mode requires eligible Claude access;
  subscription accounts need usage credits. It is billed at premium rates.
  The provider passes the selection as a session-scoped SDK setting, so it
  does not change the user's Claude defaults.
- `sandboxEnabled` defaults to `true`. In Accept Edits and Approve for me modes
  bb runs Claude Code's Bash commands in its sandbox. Set it to `false` to use
  Claude Code's own command approvals and sandbox settings instead. A change
  restarts the thread's Claude process before its next turn, preserving context.
- `fullAccessApprovalsEnabled` defaults to `false`, so Full Access approves
  every request Claude Code sends, and unattended threads never wait. Set it to
  `true` to show Claude Code's own prompts in Full Access: `permissions.ask`
  rules, PreToolUse hooks that answer `ask`, and its built-in safety checks
  (such as `rm` on a possibly-empty variable). It applies from the thread's
  next turn without a restart. When bb runs as root, Full Access always
  approves, because Claude Code refuses `bypassPermissions` there.
- `commandDescriptionsEnabled` defaults to `false`, so Bash command rows are
  titled with the command. Set it to `true` to title them with Claude's short
  description of the command instead; approval prompts and the expanded row
  still show the command. It takes effect from each thread's next message;
  existing rows keep their titles.
- The Claude bridge inherits the host daemon's environment minus `BB_*`
  variables, so `BB_CLAUDE_CODE_EXECUTABLE` picks the `claude` binary and
  `CLAUDE_CODE_OAUTH_TOKEN` authenticates a machine with no interactive login
  (mint it with `claude setup-token`). Profile providers strip credential and
  routing variables; see below.
- Claude Code's own slash commands, including bundled skills such as
  `/simplify` and `/code-review`, appear in the composer's `/` menu,
  `bb project commands`, and `bb thread commands`. The provider reads them from
  Claude Code for the project folder without sending a prompt. With **No project**
  selected, it uses an empty catalog folder on the selected machine so global
  commands appear before a workspace exists. Each thread refreshes them when a
  turn starts. Commands for settings bb manages (such as
  `/model`, `/config`, `/fast`), terminal-only commands (such as `/doctor`),
  and bb's own skills are left out.
- Structured plan, message editing, and compaction are supported through the
  corresponding `bb thread` commands. Unlisted model IDs are accepted by the
  provider; verify actual availability on the target host.

## Profiles

`profiles` registers extra native Claude Code providers. A profile is one of two
exclusive kinds: a login profile bound to its own `CLAUDE_CONFIG_DIR` and login
(for example a work account next to a personal one), or a token profile that
sends the CLI to another Anthropic-compatible endpoint with an API token read
from a file (see "Token profiles"). Native features such as the plan approval
dialog, native questions, and checkpoint forks work in profile threads, unlike
an ACP custom agent.


Set `profiles` to a JSON array with `id`, `displayName`, and `configDir`.
Each entry registers `claude-code-<id>`. List it with `bb provider list` and
its models with `bb provider models claude-code-<id>`. Select it with
`bb thread spawn --provider claude-code-<id>` or the SDK thread spawn provider
selection. For example:

```sh
bb plugin config provider-claude-code set profiles \
  '[{"id":"work","displayName":"Claude Work","configDir":"~/.claude-work"}]'
CLAUDE_CONFIG_DIR="$HOME/.claude-work" claude auth login
```

An empty value removes all profiles. An invalid value is rejected with the
reason.

- `id` matches `^[a-z0-9]+(-[a-z0-9]+)*$` (no leading, trailing, or doubled
  hyphen), is at most 41 characters, and must be unique. The provider id is
  `claude-code-<id>` (`claude-code-work`); check with `bb provider list`.
- `displayName` is non-blank, at most 80 characters.

`configDir` is `~/<subdirectory>` or a canonical absolute POSIX path. It cannot
be the home directory, the filesystem root, or contain shell, control, bidi, or
invisible characters. The profile uses only credentials and account data in that
directory. It never falls back to the default `~/.claude` login.

The profile bridge removes ambient credential, routing, and account variables.
It keeps ordinary model, feature, proxy URL, and Chrome variables. Profiles share
the plugin settings for memory, sandbox, 1M context, and Chrome. Existing threads
cannot change providers. Changing a directory or removing a profile leaves old
threads unavailable and preserves their old transcripts.

Behavior to know:

- Profiles are macOS and Linux only: `configDir` must be a POSIX path (Windows
  paths are rejected) and the sign-in hint is POSIX shell syntax.
- An absolute `configDir` equal to the host's home directory passes the setting
  check, which cannot know the home of each host, but every request on that host
  fails with "must not be the home directory". Use a subdirectory.
- `installation` maintenance is off for profiles, so the daemon's CLI preflight
  is skipped. Update the CLI through the default `claude-code` provider.
- A login profile lists user skills only from `<configDir>/skills`, never
  `~/.claude`. If the host cannot resolve native roots, it lists no user skills
  (fails closed).

## Token profiles

A token profile is `{id, displayName, authTokenFile, env}`. It points the Claude
CLI at another Anthropic-compatible endpoint, for example GLM on z.ai, with the
API token kept in a file only that profile's bridge reads. The provider id is
`claude-code-<id>`.

```sh
bb plugin config provider-claude-code set profiles \
  '[{"id":"glm","displayName":"GLM (native)","authTokenFile":"~/.config/bb/glm.token","env":{"ANTHROPIC_BASE_URL":"https://api.z.ai/api/anthropic","ANTHROPIC_DEFAULT_OPUS_MODEL":"glm-5.3[1m]","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.3-flashx[1m]","ANTHROPIC_DEFAULT_HAIKU_MODEL":"glm-5.3-flash[1m]","API_TIMEOUT_MS":"3000000"}}]'
```

Write the token (without printing it) and restrict the file. Nothing needs
reloading, because the bridge reads the file fresh each time it needs the token;
`bb provider models claude-code-glm` exercises it and is refused with the failing
check and its fix if the file is not valid:

```sh
( umask 077; mkdir -p ~/.config/bb; $EDITOR ~/.config/bb/glm.token )
chmod 600 ~/.config/bb/glm.token
```

Rules:

- `configDir` and `authTokenFile`/`env` are exclusive. An entry with both, with
  neither, with `env` but no `authTokenFile`, or with `authTokenFile` but no
  `env.ANTHROPIC_BASE_URL` is rejected, so a base URL can never fall back to a
  stored login. `env` must also set a non-empty value for at least one model variable
  (`ANTHROPIC_MODEL`, `ANTHROPIC_SMALL_FAST_MODEL`,
  `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`, or
  `ANTHROPIC_CUSTOM_MODEL_OPTION`), because the model list shows only the models
  the profile names.
- `authTokenFile` follows the `configDir` form rules: `~/<sub>` or an absolute
  canonical path, no `.` or `..` segment, no shell, control, bidi, or invisible
  character.
- `env` accepts only: `ANTHROPIC_BASE_URL` (required), `ANTHROPIC_MODEL`,
  `ANTHROPIC_SMALL_FAST_MODEL`, `ANTHROPIC_DEFAULT_{OPUS,SONNET,HAIKU,FABLE}_MODEL`
  with `_NAME`, `_DESCRIPTION`, and `_SUPPORTED_CAPABILITIES` variants,
  `ANTHROPIC_CUSTOM_MODEL_OPTION` with the same three variants, `API_TIMEOUT_MS`,
  `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, and
  `CLAUDE_CODE_AUTO_COMPACT_WINDOW`. Anything else, including
  `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `CLAUDE_CONFIG_DIR`, is
  rejected: put secrets in `authTokenFile`. Values may not contain control,
  bidi, or invisible characters.
- `ANTHROPIC_BASE_URL` is parsed as a URL: `https:`, or `http:` only for the
  hostname `localhost`, `127.0.0.1`, or `[::1]`; no userinfo, query, or
  fragment.
- Each time a session, model list, fork, health check, or usage check needs
  the token, the bridge opens `authTokenFile` without following symlinks or
  blocking, and checks
  the open descriptor: a regular file, owned by the current user, no group or
  other permission bits (`chmod 600`), at most 4 KB. One trailing `\n` or
  `\r\n` is trimmed; an empty file counts as missing; other whitespace around
  the token and any control character are rejected. `O_NOFOLLOW` covers the file
  itself; a symlinked parent directory is not checked. Rotating the token is
  picked up by the next session, model list, fork, health check, or usage
  check without restarting the bridge, and it reaches an existing thread the
  next time its session starts again (after a restart for an authentication
  failure, a setting change, or the 1M-context toggle). Every such restart
  re-reads the file first and is refused, spawning nothing and leaving the
  running session alone, if the file is no longer valid.
- It fails closed. With a missing, empty, unreadable, symlinked, or too
  permissive token file, session start, model list, and fork are refused before
  any CLI process starts (the error names the failing check and the fix), so the
  host's stored login is never sent to the base URL. A refused fork leaves the
  existing thread attached and creates no transcript. Health reports
  `unauthenticated` with the same message and `ready` when the file is valid; it
  checks the file, not the token, so a revoked token shows `ready` until the
  first turn fails with 401, which shows the token hint.
- Session env: the bridge's environment merged with the thread's `envVars`, with
  every credential/routing name and every `ANTHROPIC_*` variable and
  `CLAUDE_CONFIG_DIR` removed, then the profile `env` applied, then
  `ANTHROPIC_AUTH_TOKEN` set from the file. The token and profile `env` are never
  put in the bridge's own environment or in argv.
- The CLI's flag settings, which outrank project and local settings, pin: the
  whole profile `env`; an empty `apiKeyHelper`; every credential, routing and
  backend-switch variable the bridge strips (including every
  `CLAUDE_CODE_USE_*` backend switch, `ANTHROPIC_{BEDROCK,VERTEX,FOUNDRY}_BASE_URL`,
  and the `CLAUDE_CODE_SKIP_*_AUTH` switches) to an empty string; and the proxy
  and TLS transport variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`,
  `NO_PROXY` in both cases, `CLAUDE_CODE_HTTP_PROXY`, `CLAUDE_CODE_HTTPS_PROXY`,
  `CLAUDE_CODE_PROXY_URL`, `NODE_EXTRA_CA_CERTS`, `NODE_TLS_REJECT_UNAUTHORIZED`,
  `SSL_CERT_FILE`) to the value in the `env` block of
  `~/.claude/settings.json`, else the bridge's environment, else empty. A proxy
  or CA you set for Claude therefore still works, while a repository's
  `.claude/settings.json` can neither redirect the token, switch the backend, nor
  substitute its own `ANTHROPIC_AUTH_TOKEN`. To keep the token out of
  argv, the bridge writes these flag settings, token included, to a uniquely named
  file (created exclusively, mode 0600) in its private 0700 temp directory and
  passes the CLI only the file's path. The file is deleted when the session
  closes or is replaced, after the model probe finishes (even on failure), and on
  bridge exit; a rebuilt session or a rotated token gets a fresh file, built from
  the current token and the current `~/.claude/settings.json` proxy and TLS
  values, so edits there reach existing threads when their session next
  restarts. If the bridge is killed with SIGKILL it cannot clean up, and a 0600
  settings file holding the token can remain in its 0700 temp directory under
  `$TMPDIR`; delete it by hand. Login and default profiles pass a plain settings
  object and write no file.
- Token profiles share `~/.claude` and do not set `CLAUDE_CONFIG_DIR`, so user
  skills come from `~/.claude/skills` and `~/.claude/settings.json` is read.
  Of the auth and routing keys, only `model` and unpinned `env` keys apply from
  it: the flag pins above override its `apiKeyHelper`, the profile `env` keys and
  backend switches, and it only supplies the values of the proxy and TLS keys
  (`ANTHROPIC_UNIX_SOCKET` is always blank, since a socket set up for an Anthropic
  login must not carry third-party traffic). Hooks, permissions, MCP servers,
  plugins and `statusLine` apply as usual.
- No Auto mode (it needs Anthropic-side safety verdicts) and no Fast tier. Accept
  Edits, Plan, and Full access work. 1M context comes from the `[1m]` model id
  suffix; the plugin's `disable1MContext` setting still applies. The model list
  shows only the models named in the profile `env`. A base URL of `api.z.ai`,
  `open.bigmodel.cn`, or `dev.bigmodel.cn` also reports plan usage; any other
  base URL reports none. Setting `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` in
  the profile `env` to any trimmed value other than `0` or `false`
  (case-insensitive) turns usage off again. `installation` maintenance is off.

Data transfer: a token profile sends the whole conversation to the base URL's
operator: your prompts, the file contents tools read, and tool and Bash output,
plus CLAUDE.md, auto-memory, and bb's injected instructions and context. For a
z.ai/Zhipu base URL, bb itself additionally sends the raw token to
`<base-origin>/api/monitor/usage/quota/limit` on each usage refresh: about
every 2 minutes while a usage view (sidebar card or composer aside) is visible,
plus on focus and when Settings → Provider usage opens.
`memoryEnabled` stops
auto-memory from being sent, but it is plugin-wide, so it also turns memory off
for the default and login profiles. CLAUDE.md and injected context have no
per-profile off switch.

Tool subprocesses in token-profile threads (Bash, hooks) inherit
`ANTHROPIC_AUTH_TOKEN` and can read it, as can any process running as you that
knows the token file's path. Keeping the variable out of the CLI's own
environment would not help: the CLI exports the settings file's `env` to its
subprocesses, and removing it from the process env still authenticates and still
leaves it visible to a Bash call. The token stays out of every other provider's
threads.

Maintenance: the flag-level blanks of credential, routing and backend-switch
variables only cover the names in `src/bridge/profile-env-names.json`. Regenerate
it with `src/bridge/regenerate-profile-env-names.mjs` whenever the supported
Claude CLI version moves.


Inspect the thread and provider state after a change; do not restart unrelated
threads or change settings merely to answer a question.

Automatic context breakdowns run in a separate, non-persisted fork of the saved
conversation. Reporting never sends prompts or control requests to the live
Claude session. A timeout, replacement, or thread stop closes the reporter;
the live conversation does not wait for reporting or restart because of it.
