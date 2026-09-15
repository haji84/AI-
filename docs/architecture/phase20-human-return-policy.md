# Phase 20 human-return semantics

The coordinator returns to the human only for states already surfaced by governed execution: approval required, explicit blocker, paused/waiting boundary, or completed delivery. Ordinary recoverable failures remain inside the Goal Loop bounded recovery path. This reduces unnecessary human returns without converting approval-required work into automatic execution.
