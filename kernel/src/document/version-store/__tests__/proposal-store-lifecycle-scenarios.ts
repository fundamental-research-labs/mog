import { applyProposalWithTerminalTransitionChecks } from './proposal-store-lifecycle-acceptance-scenarios';
import { commitProposalWithValidationChecks } from './proposal-store-lifecycle-commit-scenarios';
import { createProposalDraftWithIdempotencyChecks } from './proposal-store-lifecycle-draft-scenarios';
import { openProposalLifecycleStore } from './proposal-store-lifecycle-helpers';
import { markProposalReadyForReviewWithValidationChecks } from './proposal-store-lifecycle-review-scenarios';
import { verifyProposalWithValidationChecks } from './proposal-store-lifecycle-verification-scenarios';
import { openProposalWorkspaceWithIdempotencyChecks } from './proposal-store-lifecycle-workspace-scenarios';

export function registerProposalLifecycleTests(): void {
  it('persists proposal lifecycle mutations with idempotency and CAS checks', async () => {
    const store = await openProposalLifecycleStore();
    const draft = await createProposalDraftWithIdempotencyChecks(store);
    const workspace = await openProposalWorkspaceWithIdempotencyChecks(store, draft);
    const committed = await commitProposalWithValidationChecks(store, workspace);
    const verified = await verifyProposalWithValidationChecks(store, committed);
    const ready = await markProposalReadyForReviewWithValidationChecks(store, verified);

    await applyProposalWithTerminalTransitionChecks(store, ready);
  });
}
