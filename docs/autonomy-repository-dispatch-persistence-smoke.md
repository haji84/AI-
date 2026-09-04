# Repository Dispatch Persistence Smoke

This marker verifies the owner issue bridge → repository_dispatch → Mobile Autonomy production path.

Expected behavior: one bounded plan executes once, verification passes, the run ends with `goal_complete`, and persistent autonomy state is saved for the next run.

Merge remains an explicit Human Gate.
