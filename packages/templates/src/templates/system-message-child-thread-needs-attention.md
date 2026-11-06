---
kind: prompt
title: Child thread needs attention
summary: Notifies a parent thread that one of its child threads is blocked on a pending interaction.
intent: Prompt the parent thread to inspect the blocker and either resolve it from context, ask the user, or clarify the child thread's assumption.
editingNotes: Keep this focused on parent-thread triage; do not imply the parent can approve or reject on the user's behalf.
variables:
  blockerSummary: Compact summary of the pending interaction, or a fallback sentence when no safe summary is available.
  threadMention: Serialized thread mention token, e.g. '@thread:thr_abc123'.
---
[bb system]

{{threadMention}} needs help.
{{blockerSummary}}

Review the blocker. If you can resolve it from existing context, reply to the thread with guidance. Otherwise, ask the user for the missing decision.

bb sent this message, not the user. If it cut off one of your tool calls, that was not a request to stop: check whether that call finished (and whether a state-changing call such as a spawn or commit already took effect), re-run it if you still need it, and continue your current task.
