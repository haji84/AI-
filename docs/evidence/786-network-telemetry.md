# Issue 786: browser crash from Android network telemetry

Browser console at 2026-09-16T17:00Z recorded React error31: an object with connected, validated and transport was rendered as a child. Android BrokerClient.networkState() sends that shape; JarvisConsole previously declared and rendered it as a string. Unauthenticated HTTP200 and static HTML did not exercise the client fleet refresh.

The UI now accepts unknown network telemetry and renders a bounded Japanese label, retaining legacy strings and distinguishing disconnected and unvalidated links. The regression test reproduces the React failure with the Android shape and checks safe rendering, legacy values and malformed data.

This fixes a confirmed client crash only. The owner's Chrome HTTP502 and iPhone acceptance must still be verified independently. Do not label physical remote access PASS from HTTP200 alone. Rollback: revert the UI import/call and helper in a reviewed release; keep enrollment and credentials intact.
