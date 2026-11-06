# Project checkout (fork)

## Opening paragraph

Replaces the first paragraph of README.md:

Runs threads in the project checkout on an enrolled machine. The plugin supplies the current, existing, and new branch control. Branch changes carry uncommitted changes when Git can switch without overwriting them. An in-progress Git operation or another live thread blocks switching. Removal leaves the checkout intact.

## End of README.md

## Branch promotion

The internal branch-promotion workflow uses a separate `promotion` input and `promoteBranch` host RPC; public provider validation refuses that reserved input. It requires an existing core reservation, preserves checkout ownership, and reports protocol outcomes through the provider resource.

On macOS and Linux, promotion validates the source branch and commit, requires a clean checkout with no Git operation in progress, and uses `git switch -c` for a new target or an existing local branch. A fsynced receipt binds the operation ID to its immutable intent before Git can execute. Replays inspect the checkout without repeating the mutation. Recovery creates a durable tombstone for an operation that never started and requires a fresh observation for explicit resolution. The command runs in its own process group, whose ID is recorded before execution. The entire group, including Git hooks, must have terminated before resolution; an alive or inaccessible group keeps the operation uncertain. Successful Git exit also requires observing the requested branch and, for a new branch, its source commit. Other host platforms refuse before mutation.
