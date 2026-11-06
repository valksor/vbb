---
kind: prompt
title: Child thread outcome batch
summary: Notifies a parent thread about one or more child thread outcomes.
intent: Give the parent thread compact outcome context without forcing immediate action for every child thread.
editingNotes: Keep this concise. The updates variable is a server-formatted singular or plural outcome body with rich thread mention ranges attached by the server.
variables:
  updates: "Rendered child thread outcome message body."
---
[bb system]

{{updates}}

bb sent this message, not the user. If it cut off one of your tool calls, that was not a request to stop: check whether that call finished (and whether a state-changing call such as a spawn or commit already took effect), re-run it if you still need it, and continue your current task.
