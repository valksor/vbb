For a second Claude account with native features (plan approval, native
questions, checkpoint forks), set the Claude Code plugin's profiles setting
instead of an ACP custom agent: each entry registers a claude-code-<id>
provider bound to its own CLAUDE_CONFIG_DIR login. Login profiles use only a
stored `claude auth login`. A token profile (`authTokenFile` plus an allowlisted
`env` with a required ANTHROPIC_BASE_URL and at least one non-empty
model variable, exclusive with `configDir`) runs the
CLI against another Anthropic-compatible endpoint, such as GLM on z.ai, with the
API token read from a mode-600 file, never from settings; it fails closed when
that file is missing or too permissive (re-checked whenever a thread's session
restarts, so rotation reaches existing threads), shares ~/.claude (of the auth
and routing keys, only `model` and unpinned `env` keys apply from
~/.claude/settings.json, because bb's flag settings pin `apiKeyHelper`, the
profile env, proxy/TLS keys and backend switches; hooks, permissions, MCP
servers, plugins and statusLine apply as usual), has no Auto mode or Fast tier (1M context comes from the `[1m]` model
suffix), sends the whole conversation (prompts, file contents, tool and Bash
output) plus CLAUDE.md, memory, and bb's injected context to the endpoint's
operator (the plugin-wide memoryEnabled setting turns memory off for every
profile), and lets tool subprocesses in its threads read the token. The claude-code-provider skill covers setup and limits.
