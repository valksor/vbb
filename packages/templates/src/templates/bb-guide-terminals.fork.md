Run a command in a desktop terminal

`bb run-in-terminal` takes a command from a file (or `-` for standard input)
and opens one of the user's terminal applications to run it. Use it when an
agent cannot run a command itself and pasting the command into chat would leave
the user to copy it by hand.

  bb run-in-terminal <command-file>      Use `-` to read the command from stdin
  --cwd <dir>                            Working directory (default: current directory)
  --language <sh|bash|zsh|shell>         Shell language tag of the command (default: sh)
  --target <target-id>                   Open target ID (default: the first target that can run commands)

On success it prints the terminal target that received the command, for example
`Command sent to Terminal (terminal)`. This acknowledges launch, not command
completion. The command runs on this machine
through the local bb host daemon: `BB_HOST_DAEMON_PORT` is used when set,
otherwise the CLI discovers the local daemon ports from the bb server and
probes them in order. On macOS the run-capable targets are Terminal.app, iTerm2,
and Ghostty; Linux terminals are supported through their platform terminal
target.

Safety: the command executes in the user's terminal application with that
terminal's own system permissions (macOS TCC grants), not inside any bb
sandbox. Shell history records the wrapper command, which contains the working
directory and a temporary script path; the command text itself does not enter
shell history. Prefer this command only for text the user has seen.

Failures exit non-zero with a reason: the local daemon is unreachable, the
daemon's `runCommandEnabled` gate is off (`npx bb-app client run-command on`
re-enables it), no terminal target can run commands, or the language tag is not
one of sh, bash, zsh, shell.
