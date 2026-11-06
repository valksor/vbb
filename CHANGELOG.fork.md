# Changelog (fork)

Fork entries that sit above the `## 0.48.0` heading in `CHANGELOG.md`.

**Unreleased**

- Add **Checkout, then branch** beside checkout-then-worktree. Threads can create or select a branch in the same checkout before editing, with shared-checkout admission checks and interrupted-operation recovery in metadata, SDK, and CLI (`--promote branch`).
- Fix Claude Code threads on token-profile accounts failing to start in Accept Edits and Approve-for-me modes with "Cannot use both a settings file path and the sandbox option". The sandbox now goes into the token settings file.
- Add `experimental_requireAppAnswer` to `bb.ui.requestInput`. A plugin form that sets it refuses answers that do not come from the bb app (`403 app_answer_required`, for example `bb thread interactions respond`) and stays pending. Every live plugin-form answer now records `answeredVia` (`app` or `api`) on its resolution.
