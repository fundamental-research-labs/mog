import 'fake-indexeddb/auto';

import { createIndexedDbVersionStoreProvider } from '../../../document/version-store/provider-indexeddb/backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  DOCUMENT_SCOPE,
  SENSITIVE_ACTOR,
  createReviewInput,
  versionForProvider,
} from './version-review-provider-test-utils';

describe('WorkbookVersion provider-backed review persistence', () => {
  it('keeps review access projection fields after IndexedDB provider reopen', async () => {
    await deleteVersionStoreIndexedDbForTesting();
    let provider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;
    let reloadedProvider: ReturnType<typeof createIndexedDbVersionStoreProvider> | undefined;

    try {
      provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const version = versionForProvider(provider);
      const created = await version.createReview({
        ...createReviewInput('indexed-projection-review-1'),
        createdBy: SENSITIVE_ACTOR,
      });
      if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);

      const decision = await version.appendReviewDecision({
        reviewId: created.value.id,
        expectedRevision: 1,
        clientRequestId: 'indexed-projection-decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: SENSITIVE_ACTOR,
          body: 'Please review with principal-secret.',
          metadata: { principalId: 'principal-secret', publicNote: 'kept-after-reopen' },
        },
      });
      if (!decision.ok) throw new Error(`expected decision success: ${decision.error.code}`);

      const status = await version.updateReviewStatus({
        reviewId: created.value.id,
        expectedRevision: 2,
        clientRequestId: 'indexed-projection-status-1',
        status: 'changes_requested',
        actor: SENSITIVE_ACTOR,
        reason: 'Blocked for principal-secret.',
      });
      if (!status.ok) throw new Error(`expected status success: ${status.error.code}`);

      await provider.close();
      reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const reloadedVersion = versionForProvider(reloadedProvider);
      const fetched = await reloadedVersion.getReview({ reviewId: created.value.id });
      if (!fetched.ok) throw new Error(`expected get success: ${fetched.error.code}`);

      expect(fetched.value).toMatchObject({
        id: created.value.id,
        revision: 3,
        status: 'changes_requested',
        redaction: { redactedFields: expect.arrayContaining(['reviewAuthors.principalTrace']) },
        decisions: [
          expect.objectContaining({
            body: 'Please review with redacted-principal.',
            metadata: { publicNote: 'kept-after-reopen' },
          }),
        ],
        diagnostics: [
          expect.objectContaining({
            message: 'Blocked for redacted-principal.',
          }),
        ],
      });
      const serialized = JSON.stringify(fetched.value);
      expect(serialized).not.toContain('principal-secret');
      expect(serialized).not.toContain('agent-secret');
      expect(serialized).toContain('redacted-principal');
    } finally {
      await provider?.close();
      await reloadedProvider?.close();
      await deleteVersionStoreIndexedDbForTesting();
    }
  });
});
