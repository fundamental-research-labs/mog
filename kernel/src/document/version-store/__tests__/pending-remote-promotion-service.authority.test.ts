import { createPendingRemotePromotionService } from '../pending-remote-promotion-service';
import { createInMemoryVersionStoreProvider } from '../provider';
import {
  DOCUMENT_SCOPE,
  expectGraphHead,
  expectReadHeadSuccess,
  initializeProvider,
  pendingSegmentFixture,
  persistAndReservePendingSegment,
  PROMOTION_NOW,
} from './pending-remote-promotion-service.test-helpers';

describe('PendingRemotePromotionService', () => {
  it.each([
    ['unknown', { authorityRef: null }, 'provider-authority-unknown', null, []],
    ['stale', { epoch: null }, 'provider-authority-stale', null, []],
    [
      'malformed readback',
      {
        collaboration: {
          validationDiagnosticCount: 0,
          exclusionReason: 'provider-secret-ref',
          exclusionSubreason: 'raw-authority-id',
        },
      },
      'provider-authority-unknown',
      {
        gate: 'provider-cycle-readback',
        field: 'exclusionReason',
        expected: 'absent-when-validation-clean',
        malformed: true,
      },
      ['provider-secret-ref', 'raw-authority-id', 'provider-1', 'authority-1'],
    ],
  ] as const)(
    'skips %s provider authority before creating a graph commit',
    async (_label, options, reason, expectedDetails, redactedRawIds) => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const namespace = await initializeProvider(provider, `graph-${reason}`);
      const graph = await provider.openGraph(namespace);
      const store = await provider.openPendingRemoteSegmentStore(namespace);
      const fixture = await pendingSegmentFixture(namespace, options);
      await persistAndReservePendingSegment(graph, store, fixture);
      const headBefore = await expectReadHeadSuccess(graph);

      const result = await createPendingRemotePromotionService({
        provider,
        now: () => PROMOTION_NOW,
      }).promotePendingRemoteSegments();

      expect(result).toMatchObject({
        status: 'failed',
        commitIds: [],
        skipped: [{ segmentId: fixture.input.pendingRemoteSegmentId, reason }],
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PENDING_REMOTE_PROMOTION_AUTHORITY_BLOCKED',
            reason,
            ...(expectedDetails === null
              ? {}
              : { details: expect.objectContaining(expectedDetails) }),
          }),
        ],
      });
      for (const raw of redactedRawIds) expect(JSON.stringify(result)).not.toContain(raw);
      await expectGraphHead(graph, headBefore);
      await expect(
        store.readBySegmentId(fixture.input.pendingRemoteSegmentId),
      ).resolves.toMatchObject({ status: 'found', record: { state: 'pending' } });
    },
  );
});
