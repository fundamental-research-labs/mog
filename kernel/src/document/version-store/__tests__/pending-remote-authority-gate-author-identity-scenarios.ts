import { validatePendingRemoteProviderAuthority } from '../pending-remote-authority-gate';

import { AUTHOR, pendingRemoteRecord } from './pending-remote-authority-gate-test-helpers';

export function registerPendingRemoteAuthorityGateAuthorIdentityScenarios() {
  it('blocks author-session mismatches as structured stale authority diagnostics', async () => {
    const record = await pendingRemoteRecord({
      author: { ...AUTHOR, sessionId: 'remote-session-rotated' },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-stale',
      details: {
        gate: 'author-identity',
        field: 'remoteSessionId',
        authorPresent: true,
        collaborationPresent: true,
      },
    });
  });

  it('blocks mixed-author pending remote promotion as structured unknown authority', async () => {
    const record = await pendingRemoteRecord({
      author: {
        authorId: 'sync:mixed-remote',
        actorKind: 'system',
      },
      collaboration: {
        sourceKind: 'providerMixedInbound',
        authorState: 'mixedRemote',
        exclusionReason: 'mixedAuthors',
        exclusionSubreason: 'aggregateWithoutBoundaries',
      },
    });

    expect(validatePendingRemoteProviderAuthority(record)).toMatchObject({
      status: 'blocked',
      reason: 'provider-authority-unknown',
      details: {
        gate: 'author-identity',
        field: 'authorState',
        expected: 'singleRemote',
        actual: 'mixedRemote',
        exclusionReason: 'mixedAuthors',
        exclusionSubreason: 'aggregateWithoutBoundaries',
      },
    });
  });
}
