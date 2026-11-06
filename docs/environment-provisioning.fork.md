# Environment and thread startup (fork)

## Provider that returns an existing project checkout

Replaces the upstream bullet "A provider that returns an existing project checkout ...":

- A provider that returns an existing project checkout keeps that checkout's
  identity (instance key, resource, merge base, path ownership) and retires the
  unused reservation. The adopted row keeps the reservation's own provider
  selection so placement does not read it as a changed request. Cancelling the
  reservation releases the adopted environment instead of removing it:
  `adoptedFromStatus` restores its earlier status and clears ownership, claim,
  and teardown fields, and attaching clears the marker. A rejected foreign path records
  an error and is never handed to removal.
