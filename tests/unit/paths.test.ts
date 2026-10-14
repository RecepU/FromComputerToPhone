import { it, expect } from 'vitest';
import { applicationPath } from '../../apps/web/src/services/paths';
import { joinCredentials, secureToken } from '../../packages/shared/protocol';
it('supports Pages subpath guest URLs while preserving root-hosted cloud URLs', () => {
  const room = secureToken(),
    guest = secureToken();
  expect(
    joinCredentials(
      applicationPath(
        `/FromComputerToPhone/join/${room}`,
        '/FromComputerToPhone/',
      ),
      `#${guest}`,
    ),
  ).toEqual({ room, secret: guest });
  expect(applicationPath(`/join/${room}`, '/')).toBe(`/join/${room}`);
  expect(applicationPath('/Unrelated/join/x', '/FromComputerToPhone/')).toBe(
    '/Unrelated/join/x',
  );
});
