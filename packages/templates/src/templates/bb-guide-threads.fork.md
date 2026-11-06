Branch promotion recovery

  bb thread promotion inspect <id> [--json]
  bb thread promotion resolve <id> --operation <id> --observation <token>
    --accept-current              Accept the requested target at the observed HEAD
    --keep-current                Decline promotion and stay on the observed branch
    --json                        Print machine-readable JSON

  Choose exactly one resolution. Inspect supplies the operation and observation;
  stale observations are rejected. Recovery does not mutate Git. Interrupted
  operations block the checkout until the host proves process-group termination.
  There is no force-unlock. thread show reports promotion target and state.

  --promote worktree|branch works on spawn and fork, and conflicts with environment,
  base-branch, and machine placement flags. No flag preserves existing defaults:
  spawn uses the project default and fork reuses its source environment.
  Checkout, then branch keeps a shared checkout, requires macOS/Linux, and refuses
  another live thread on that checkout. BB generates a new branch name unless the
  user explicitly requests an existing branch. It provides no filesystem isolation.
  SDK spawn/fork accept environment: { type: "project-default", promotion: "branch" }
  (or "worktree"). threads.inspectBranchPromotion({ threadId }) and
  threads.resolveBranchPromotion({ threadId, operationId, observation, resolution })
  expose the same recovery; resolution is "accept-current" or "keep-current".
