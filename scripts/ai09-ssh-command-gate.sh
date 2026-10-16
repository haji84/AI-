#!/bin/sh
# Issue #1798: forced SSH command for bounded, read-only acceptance probes.
# Install only through the separately reviewed, host-scoped SSH provisioning step.
set -eu
PATH=/usr/bin:/bin
export PATH
umask 077

case "${SSH_ORIGINAL_COMMAND-}" in
    ai09-identity-v1)
        printf 'AI09_IDENTITY_V1\n'
        /usr/bin/id
        exec /usr/bin/hostname
        ;;
    ai09-exit7-v1)
        printf 'AI09_STDOUT_V1\n'
        printf 'AI09_STDERR_V1\n' >&2
        exit 7
        ;;
    ai09-timeout-v1)
        printf 'AI09_TIMEOUT_STARTED_V1\n'
        exec /usr/bin/sleep 5
        ;;
    *)
        printf 'AI09_COMMAND_REFUSED\n' >&2
        exit 64
        ;;
esac
