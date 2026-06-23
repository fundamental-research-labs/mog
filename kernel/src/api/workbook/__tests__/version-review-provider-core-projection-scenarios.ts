import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  DOCUMENT_SCOPE,
  SENSITIVE_ACTOR,
  createReviewInput,
} from './version-review-provider-test-utils';

export function registerReviewProviderCoreProjectionScenarios(): void {
  it('projects provider-backed review read and write records through public-safe access', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
    attachWorkbookVersioning(ctx, { provider });
    const version = new WorkbookVersionImpl(ctx);

    const created = await version.createReview({
      ...createReviewInput('projection-review-1'),
      createdBy: SENSITIVE_ACTOR,
    });
    if (!created.ok) throw new Error(`expected create success: ${created.error.code}`);
    expect(JSON.stringify(created.value)).not.toContain('principal-secret');
    expect(JSON.stringify(created.value)).not.toContain('agent-secret');
    expect(created.value.redaction.redactedFields).toContain('reviewAuthors.principalTrace');

    const listed = await version.listReviews({});
    if (!listed.ok) throw new Error(`expected list success: ${listed.error.code}`);
    expect(JSON.stringify(listed.value)).not.toContain('principal-secret');

    const fetched = await version.getReview({ reviewId: created.value.id });
    if (!fetched.ok) throw new Error(`expected get success: ${fetched.error.code}`);
    expect(JSON.stringify(fetched.value)).not.toContain('principal-secret');

    const decision = await version.appendReviewDecision({
      reviewId: created.value.id,
      expectedRevision: 1,
      clientRequestId: 'projection-decision-1',
      decision: {
        target: { kind: 'proposal', proposalId: 'proposal-1' },
        decision: 'comment',
        reviewer: SENSITIVE_ACTOR,
        body: 'Please review with principal-secret.',
        metadata: { principalId: 'principal-secret', publicNote: 'kept' },
      },
    });
    if (!decision.ok) throw new Error(`expected decision success: ${decision.error.code}`);
    expect(JSON.stringify(decision.value)).not.toContain('principal-secret');
    expect(JSON.stringify(decision.value)).not.toContain('agent-secret');
    expect(JSON.stringify(decision.value)).toContain('publicNote');

    const status = await version.updateReviewStatus({
      reviewId: created.value.id,
      expectedRevision: 2,
      clientRequestId: 'projection-status-1',
      status: 'changes_requested',
      actor: SENSITIVE_ACTOR,
      reason: 'Blocked for principal-secret.',
    });
    if (!status.ok) throw new Error(`expected status success: ${status.error.code}`);
    expect(JSON.stringify(status.value)).not.toContain('principal-secret');
    expect(JSON.stringify(status.value)).toContain('redacted-principal');
  });
}
