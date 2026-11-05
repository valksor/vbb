---
kind: instruction
title: bb Terminal Guide
summary: Managing persistent terminals across thread, environment, and machine scopes, and running one command elsewhere with terminal run.
intent: Help agents route terminal sessions explicitly, manage them by terminal ID, and run one-shot commands on another machine.
editingNotes: Keep scope selectors, run and wait exit codes, and ID-only commands aligned with bb terminal --help.
---
Terminal commands

Use terminals for long-running commands that should stay alive for the user,
such as dev servers, watch tasks, REPLs, and database consoles. A terminal is a
real persistent PTY and appears in the bb UI.

List and create require exactly one explicit scope:

  bb terminal list --thread <thread-id>
  bb terminal list --environment <environment-id>
  bb terminal list --machine <id-or-name> [--cwd <path>]

  bb terminal create --thread <thread-id> --command "pnpm dev"
  bb terminal create --environment <environment-id>
  bb terminal create --machine <id-or-name> [--cwd <path>]   (alias: start)
    --host <id-or-name>                   Alias for --machine
    --title <title>                       Display title
    --id <terminal-id>                    Use this ID (term_ plus 10 characters); fails if it exists
    --cols <n>                            Initial terminal columns (default: 200)
    --rows <n>                            Initial terminal rows (default: 50)
    --attach                              Attach after creating
    --json                                Print machine-readable output

Machine names are resolved to an explicit machine ID. No scope defaults to the
server machine, and --cwd is valid only with --machine or --host.

A terminal runs the machine's own shell: $SHELL (then zsh, bash, sh) on macOS
and Linux; on Windows, PowerShell 7 when `pwsh` is on PATH, otherwise Windows
PowerShell, otherwise cmd. Write --command in that shell's syntax. To run a
program with arguments without knowing the shell, pass them after `--`
(`bb terminal create --thread <id> -- pnpm test "my file.ts"`): the machine
quotes each argument for its own shell. `send --enter` presses Enter (a carriage
return), which every one of those shells accepts. The terminal's exit code is
the command's own exit code on every shell.

All other operations need only the terminal ID. They also accept the scope
flags above and ignore them, so a command built for `list` or `create` still
runs:

  bb terminal show <terminal-id>
  bb terminal attach <terminal-id>        Ctrl-B d detaches
  bb terminal send <terminal-id> --text <text> [--enter]
    --stdin                               Read bytes from stdin instead of --text
  bb terminal resize <terminal-id> --cols <n> --rows <n>
  bb terminal rename <terminal-id> <title>
  bb terminal restart <terminal-id>       Atomically replaces it with a shell; does not replay the original command
  bb terminal close <terminal-id> [--if-clean]   (alias: stop)

  bb terminal output <terminal-id>
    --since-seq <n>                       Read output chunks from a sequence
    --tail-bytes <n>                      Bound output to latest N bytes
    --limit-chunks <n>                    Bound output to latest N chunks
    --plain                               Print plain text, with colors and progress redraws removed
    --json                                Print chunks, nextSeq, truncated, status, exitCode, and closeReason

  Output stays readable after the command exits: the machine keeps a finished
  terminal's scrollback for 30 minutes, until its daemon restarts, or until many
  newer terminals have exited. For an exited terminal the output is followed by
  `Terminal <id> exited with code N` on stderr. Once the scrollback is gone,
  output fails with `terminal_output_unavailable` and says why.

  bb terminal wait <terminal-id>
    --exit                                Wait until the terminal exits (the default)
    --contains <text>                     Return once new output contains text
    --regex <pattern>                     Return once new output matches regex
    --since-seq <n>                       Start from this sequence (default: the current end for --contains or --regex, 0 otherwise)
    --from-start                          Start from sequence 0
    --timeout <duration>                  Stop waiting after this long; the terminal keeps running. Seconds, or a duration with a unit: 90s, 5m (default: 30s)
    --poll-interval <duration>            Milliseconds, or a duration with a unit (default: starts at 100ms and backs off to 1s)
    --max-output-bytes <n>                Return the last N bytes of output (default: 65536)
    --json                                Print terminalId, status, observation, exitCode, closeReason, output, truncated, and nextSeq

  Wait prints the terminal's output from where the wait started as plain text,
  with colors and progress redraws removed, then a status line on stderr. Text
  and regex matching ignore terminal escapes too, so `--contains "Local:"`
  matches a bold `Local`. It ends with the same exit codes as `terminal run`
  below.

For a dev server, prefer:

  bb terminal create --thread <thread-id> --title "pnpm dev" --command "pnpm dev"
  bb terminal wait <terminal-id> --contains "Local:" --timeout 120

Do not run long-lived servers as one-off foreground commands when the user will
need to inspect logs, refresh the page, or stop the process later.

Run a command and get its result

Use your own shell for commands in your current workspace. Use `bb terminal
run` to run a command on another machine or in another environment and get its
output and exit code in one call. It takes the same scope flags as `create`:

  bb terminal run --machine <id-or-name> --cwd <path> -- <program> [args...]
  bb terminal run --environment <environment-id> -- <program> [args...]
    --contains <text>                     Return once the output contains text
    --regex <pattern>                     Return once the output matches regex
    --timeout <duration>                  Stop waiting after this long; the command keeps running (default: 30s)
    --max-output-bytes <n>                Return the last N bytes of output (default: 65536)
    --id <terminal-id>                    Run under this ID (term_ plus 10 characters); a retry with it fails instead of running twice
    --title <title>                       Terminal title (default: the command)
    --cols <n>, --rows <n>                As for create
    --json                                Same shape as terminal wait --json

Pass the program and its arguments after `--`; the machine quotes them for its
shell, as `terminal create -- ...` does. Write `sh -c '...'` (or the machine's
shell) for pipes and `&&`. The command runs in a new terminal, so it appears in
the bb UI and the other terminal commands work on its ID. It runs in a PTY:
stdout and stderr arrive interleaved in one output, colors and progress
redraws are removed from it, and commands that page or prompt (`git log`,
`npm init`) wait for input. Use `git --no-pager` or the command's
non-interactive flags.

Run and wait end with the same exit codes:

  the command's exit code                 It exited
  0                                       --contains or --regex matched; it may still be running
  1                                       It exited before the text appeared, or its terminal was closed before it finished
  124                                     Still running after --timeout

Returning never stops the command. Continue with the `bb terminal wait` line
printed on stderr, stop it with `bb terminal close <terminal-id>`, or read all
of its output with `bb terminal output <terminal-id>`. After the machine
discards a finished command's output, wait still reports its exit code, with
`output` null. When run fails without printing a result, check
`bb terminal list` in the same scope before running it again, or pass `--id`
so a retry cannot run it twice.

In the app, Find in terminal (`terminal.find`; Cmd+F on macOS, Ctrl+Shift+F
elsewhere) searches the focused terminal's scrollback; Enter and Shift+Enter
move between matches, Match case toggles case sensitivity, and Escape closes
find and returns focus. Rebind it in Settings → Keyboard or with
`bb settings keyboard set terminal.find <shortcut>`; the SDK's
`system.updateKeyboardSettings` accepts the same command ID.

Terminal URLs and file paths open with Cmd+click on macOS, Ctrl+click
elsewhere, or a tap on touch screens. Printed file paths, including `path:line`
and `path:line:column`, open in bb's file viewer on the terminal's machine.
Relative paths use the shell's OSC 7 working directory when reported, otherwise
the session's initial directory. Quoted paths may contain spaces.

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
