Start a thread, pick Claude Code, and let it work in your repository from bb. The plugin drives the Claude Code CLI on the host machine. It streams the agent's work into the bb timeline.

## What you get

- Permission modes `accept-edits`, `auto`, and `full`, plus a plan action in the composer.
- Reasoning levels from Low to Max, plus Ultracode, which turns on multi-agent workflow orchestration.
- Checkpoint forks, manual compaction, and native questions from the agent.
- Claude Code skills and provider-native CLAUDE.md or supported AGENTS.md files
  from your home directory and project.
- Health, usage, and install status for Claude Code on each host, with an install or update action.

## Settings

- `Claude Code memory`: let Claude Code read and write its auto-memory.
- `Disable provider subagents`: hide native Agent, Task, and ListAgents tools so the agent delegates through bb. Changes restart Claude before the next turn, preserving the conversation.
- `Disable Workflow tool`: hide the native Workflow tool.
- `Claude in Chrome`: start Claude Code with the browser tools.
- `Profiles`: add Claude Code providers beside the default. A login profile has its own sign-in, such as a work account (`claude-code-work` for `~/.claude-work`); it needs an `id`, a `displayName`, and a `configDir`, uses only that directory's stored `claude auth login`, and skips the CLI install and update check. A token profile (`id`, `displayName`, `authTokenFile`, `env`) runs the CLI against another Anthropic-compatible endpoint, such as GLM on z.ai: `env` is an allowlist with a required `ANTHROPIC_BASE_URL` and at least one non-empty model variable, and the API token comes from the mode-600 `authTokenFile`. It fails closed when the file is bad (re-checked whenever a thread's session restarts, so a rotated token reaches existing threads), shares `~/.claude` (of the auth and routing keys, only `model` and unpinned `env` keys apply from `~/.claude/settings.json`, because bb's flag settings pin `apiKeyHelper`, the profile env, proxy/TLS keys and backend switches; hooks, permissions, MCP servers, plugins and `statusLine` apply as usual), has no Auto mode or Fast tier (1M context comes from the `[1m]` model suffix), and sends the whole conversation (prompts, file contents, tool and Bash output) plus CLAUDE.md, memory, and bb's injected context to the endpoint's operator. `Claude Code memory` is plugin-wide and also turns memory off for the other profiles. Tool subprocesses in token-profile threads can read the token. For a z.ai/Zhipu base URL (`api.z.ai`, `open.bigmodel.cn`, or `dev.bigmodel.cn`), the profile also reports plan usage: bb sends the raw token to `<base-origin>/api/monitor/usage/quota/limit` on each usage refresh (about every 2 minutes while a usage view is visible, plus on focus and when Settings → Provider usage opens); setting `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` in the profile `env` to any trimmed value other than `0` or `false` (case-insensitive) turns that off.

## Requirements

- Install the Claude Code CLI (`claude`) on the host machine. The plugin can run the installer for you.
- Sign in with `claude` on that machine. bb reads the sign-in state to show account and plan. For a login profile, sign in with `CLAUDE_CONFIG_DIR="$HOME/<sub>" claude auth login` (use the absolute path in single quotes when `configDir` is absolute). For a token profile, put the API token in its `authTokenFile` and run `chmod 600` on it.
- `Claude in Chrome` needs the Chrome extension and a claude.ai login on the host.
