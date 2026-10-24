// Disposable Node authority for the Windows enrollment VM. No device key is supplied:
// the actual Windows enrollment client must generate, protect and prove its own key.
import { createInterface } from 'node:readline';
import { ManualRemoteCoordinator } from '../src/remote-lite/manual-coordinator.mjs';
import { createLoopbackSignaling } from '../src/remote-lite/loopback-signaling.mjs';

const ownerId = 'windows-setup-vm';
const authorization = 'public-local-vm-fixture-only';
const coordinator = new ManualRemoteCoordinator({ authorizeOwner: p => p.ownerId === ownerId && p.authorization === authorization });
const server = createLoopbackSignaling({ coordinator, authenticateOwnerRequest: async () => null });
try {
  const bound = await server.start();
  const invite = coordinator.issueInvite({ ownerId, authorization });
  process.stdout.write(JSON.stringify({ url: `http://127.0.0.1:${bound.port}`, inviteCode: invite.inviteCode }) + '\n');
  for await (const line of createInterface({ input: process.stdin })) {
    const command = JSON.parse(line);
    if (command.action === 'exit') break;
    if (command.action === 'approve') {
      coordinator.approveDevice({ ownerId, authorization, requestId: command.requestId, expectedFingerprint: command.fingerprint });
      process.stdout.write('approved\n');
    } else if (command.action === 'revoke') {
      coordinator.revokeDevice({ ownerId, authorization, deviceId: command.deviceId });
      process.stdout.write('revoked\n');
    } else throw new Error('Unknown fixture action');
  }
} catch {
  process.stderr.write('Windows setup authority fixture failed\n');
  process.exitCode = 1;
} finally { await server.stop(); }
