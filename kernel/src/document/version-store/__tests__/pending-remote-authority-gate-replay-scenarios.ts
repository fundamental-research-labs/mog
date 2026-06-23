import { validatePendingRemoteProviderAuthority } from '../pending-remote-authority-gate';

import { pendingRemoteRecord } from './pending-remote-authority-gate-test-helpers';

export function registerPendingRemoteAuthorityGateReplayScenarios() {
  it('blocks replay high-water mismatches with field-level diagnostics', async () => {
    const record = await pendingRemoteRecord({
      syncIdentity: { updateId: 'remote-update-previous' },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-stale',
      details: {
        gate: 'replay-high-water',
        field: 'updateId',
        reservedPresent: true,
        collaborationPresent: true,
      },
    });
  });

  it.each([
    [
      'replayed provider bytes',
      { replay: true },
      { field: 'replay', expected: false, actual: true, sourceKind: 'providerLiveInbound' },
    ],
    [
      'provider replay source',
      { sourceKind: 'providerReplay' },
      { field: 'sourceKind', expected: 'providerLiveInbound', actual: 'providerReplay' },
    ],
  ] as const)(
    'blocks %s as replay high-water authority',
    async (_label, collaboration, details) => {
      const record = await pendingRemoteRecord({ collaboration });

      expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
        status: 'blocked',
        reason: 'provider-authority-stale',
        details: {
          gate: 'replay-high-water',
          ...details,
        },
      });
    },
  );
}
