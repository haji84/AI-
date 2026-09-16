# Owner screen sequence — #734

Owner supplied three reference screens on 2026-09-16: first-stage event screen,
second-stage receipt screen, and an error screen. Error takes priority over success.
No account switching, retrying links, or bypassing errors is implemented.

The existing `/jarvis/qa` two-URL runner now supports a Google spreadsheet deep
link between stages. The app must be observed before URL2 is opened. Both success
screens must be observed twice in the configured target package. Unknown screens
time out without proceeding; observation failures do not resend inputs. Completion
requires force-stop of the configured app, HOME input and observation of the
resolved launcher. A close/HOME failure cannot report completion.

Matching uses Android accessibility text/content descriptions, not image recognition.
Reference photographs are not themselves physical execution evidence. A WebView
that does not expose the expected labels will stop on timeout. Japanese whitespace
and line wrapping are normalized; error markers override simultaneous success text.

Current limitation: the owner must supply the sheet link and the two action URLs.
The runner reopens the specified file but does not discover cells or tap spreadsheet
links. This is not full demonstrated procedure replay or a spreadsheet importer.
The specific file/cells and actual URL run remain pending owner input. Existing
callers without a sheet link retain the direct two-URL flow.

Validation: synthetic state-machine tests cover both success stages, errors at
either stage, unknown/out-of-order screens, failed sheet return, failed HOME,
line-wrapped labels, metadata spoofing and spreadsheet URL restrictions. Device
package inspection confirms Sheets and TikTok Lite installed on A202ZT; it does
not prove actual task execution. No physical end-to-end PASS claimed.

Rollback: revert this change; no teaching records, database schemas, credentials
or permissions are modified.
