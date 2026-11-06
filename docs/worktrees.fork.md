# Worktrees and setup scripts (fork)

## Introduction (after the opening paragraph, before the `.worktreeinclude` paragraph)

The environment picker's default for project threads is **Project checkout**:
the thread stays in the project's existing checkout, and concurrent threads
share its files. To keep the checkout untouched, pick **Checkout, then
worktree**: the thread starts in the checkout so the agent can use
checkout-local indexes and other read-only tooling, and the agent is
instructed to ask bb for a managed worktree before its first project
mutation, with bb queueing continuation in that worktree. This coordination
is not a filesystem write barrier: select **Worktree** when isolation must
exist from the first command. Promotion refuses a dirty, detached, unborn, or
mid-operation checkout rather than silently continuing from different code.

On the CLI and SDK, a thread created without an explicit environment still
takes the checkout-then-worktree default, so the app and the CLI differ until
an environment is chosen explicitly.

## Checkout, then branch

Choose **Checkout, then branch** to explore in the project checkout and switch
its branch before the first edit. This shares files with other checkout users.
Another live BB thread using the same path blocks the switch. It requires a
clean Git checkout on macOS or Linux; it refuses detached or unborn HEAD,
conflicts, in-progress Git operations, and an existing generated branch name.

The agent calls `bb_enter_branch` with `{}` to create a generated branch from
the verified current commit, or `{ "branch": "existing-local-branch" }` when
you request an existing branch. BB keeps the same environment and directory;
no worktree, setup script, or continuation turn is created. Existing-branch
switches and recovered operations require the agent to re-read relevant files.
This is an instruction-driven workflow, not a filesystem write barrier.

Use `bb thread spawn --project ID --promote branch --prompt "..."` or
`bb thread fork ID --promote branch`. SDK create/fork requests select
`environment: { type: "project-default", promotion: "branch" }`. Omitted
promotion preserves the worktree default. Explicit branch promotion refuses
an unavailable checkout rather than falling back to a different environment.

For this choice, asking to stay in the checkout still permits branching there.
Explicitly ask to keep the **current branch** or skip branching to decline it.
The thread records `promotionTarget` and `worktreePromotion` separately.

An interrupted switch retains a checkout reservation until its outcome is
known. Inspect it from thread metadata or `bb thread promotion inspect ID`.
After the host confirms the entire Git command has terminated, choose **Accept
current target** to accept the observed target branch, or **Keep current
checkout and skip promotion** to decline and keep the observed checkout.
Neither action changes Git. CLI resolution requires the operation ID and fresh
observation token returned by inspection; `--accept-current` requires the
requested target branch. An unreachable host must reconnect; there is no force
unlock. BB coordinates its own operations, not external editors or Git commands.

## Working in the checkout instead

Promotion is armed for the two **Checkout, then…** choices. Other deliberate
placements keep the thread where you put it:

- Pick **Project checkout** in the environment picker, and the thread stays in
  your checkout for its whole life.
- Pass `bb thread spawn --environment-provider project-checkout` to choose the
  checkout explicitly from the CLI.
- Ask mid-thread — "work in the checkout", "skip the worktree", or decline one
  the agent offers. The agent records it with `bb_keep_checkout` and bb stops
  raising it for the rest of the thread, rather than re-asking every turn.

A thread already running in a worktree cannot be moved back this way; use
`update_environment_directory` to point it at a different directory.
