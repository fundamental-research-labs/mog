import { validatePendingRemoteProviderAuthority } from '../pending-remote-authority-gate';

import { pendingRemoteRecord } from './pending-remote-authority-gate-test-helpers';

export function registerPendingRemoteAuthorityGateProviderIdentityScenarios() {
  it('blocks provider identity mismatches as structured stale authority diagnostics', async () => {
    const record = await pendingRemoteRecord({
      syncIdentity: { providerId: 'provider-rotated' },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-stale',
      details: {
        gate: 'provider-identity',
        field: 'providerId',
        reservedPresent: true,
        collaborationPresent: true,
      },
    });
  });
}
