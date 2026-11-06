A thread that takes bb's project default starts in the project's existing
checkout so agents can use checkout-local read-only tooling, and is instructed to
ask bb for a managed worktree before its first project mutation; bb queues the
continuation in that worktree. This is agent coordination, not a filesystem write
barrier. Use `bb thread spawn --new-environment worktree ...` when isolation must
exist from the first command. Lazy promotion refuses dirty, detached, unborn, or
mid-operation checkouts rather than continuing from different code.

Promotion is armed for that implicit default or an explicit `--promote` selection. Naming an environment
already says where the work belongs, so `--environment`, `--environment-provider`,
and the app's Project checkout entry all keep the thread where you put it. Use
`bb thread spawn --environment-provider project-checkout` to choose the checkout
from the CLI. For worktree promotion, if a user asks mid-thread to stay in the
checkout, the agent records it with `bb_keep_checkout`, which holds for the rest
of the thread. For branch promotion, staying in the checkout still permits
branching there; decline only when the user asks to keep the current branch or
skip branching.

Use `bb thread spawn --promote branch ...` or `bb thread fork ID --promote branch`
for Checkout, then branch. It stays in the shared project checkout and switches
its branch before the first project mutation; it does not create isolation.
Another live thread on that checkout blocks the switch. The host must run macOS
or Linux. BB generates a new branch name unless the user explicitly requests an
existing branch. `--promote worktree` explicitly selects Checkout, then worktree.
Do not combine `--promote` with environment, base-branch, or machine placement
flags. An omitted flag preserves spawn defaults and fork source-environment reuse.

`bb thread show ID` reports the promotion target and state (armed, declined, or
promoted). For interrupted branch promotion, run `bb thread promotion inspect ID`
to obtain the operation ID and current observation token. The checkout remains
blocked until the host proves the command process group terminated. Resolve with
`bb thread promotion resolve ID --operation OP --observation TOKEN --accept-current`
to accept the requested target at the observed HEAD, or `--keep-current` to decline
promotion and stay on the observed branch. These recovery choices do not mutate
Git; stale observations are rejected and there is no force-unlock.
