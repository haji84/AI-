/** Test-only recognition of the three exact-head checkout additions.
 * Everything else remains subject to R66's original frozen workflow digest.
 */
const HEAD = '${{ github.event.pull_request.head.sha || github.sha }}';
const CHECKOUT = '      - uses: actions/checkout@v4\n';
const LINUX_PIN = `${CHECKOUT}        with:
          ref: ${HEAD}
      - name: Require exact source SHA
        shell: bash
        env:
          GORIQ_EXPECTED_SOURCE_SHA: ${HEAD}
        run: |
          set -euo pipefail
          test "$(git rev-parse HEAD)" = "$GORIQ_EXPECTED_SOURCE_SHA"
`;
const WINDOWS_PIN = `${CHECKOUT}        with:
          ref: ${HEAD}
      - name: Require exact source SHA
        shell: powershell
        env:
          GORIQ_EXPECTED_SOURCE_SHA: ${HEAD}
        run: |
          if ((& git rev-parse HEAD).Trim() -ne $env:GORIQ_EXPECTED_SOURCE_SHA) { throw 'SOURCE_SHA_MISMATCH' }
`;
export const PIN_BLOCKS = Object.freeze({
  'repository-guard': LINUX_PIN,
  'project-checks': LINUX_PIN,
  'windows-runtime-byte-fixtures': WINDOWS_PIN,
});

export function restoreR66WorkflowBaseline(workflow) {
  const refuse = () => { throw new Error('EXACT_HEAD_CHECKOUT_CONTRACT'); };
  if (typeof workflow !== 'string' || workflow.length > 65536 || workflow.includes('\0')
      || workflow.split('      - name: Require exact source SHA\n').length !== 4) refuse();
  let normalized = workflow;
  for (const [job, block] of Object.entries(PIN_BLOCKS)) {
    const heading = `\n  ${job}:\n`;
    const start = normalized.indexOf(heading);
    if (start < 0 || normalized.indexOf(heading, start + heading.length) >= 0) refuse();
    const bodyStart = start + heading.length;
    const next = /\n {2}[A-Za-z0-9_-]+:\n/.exec(normalized.slice(bodyStart));
    const end = next ? bodyStart + next.index : normalized.length;
    const body = normalized.slice(bodyStart, end);
    const at = body.indexOf(block);
    if (at < 0 || body.indexOf(block, at + block.length) >= 0) refuse();
    normalized = normalized.slice(0, bodyStart) + body.replace(block, CHECKOUT) + normalized.slice(end);
  }
  return normalized;
}
