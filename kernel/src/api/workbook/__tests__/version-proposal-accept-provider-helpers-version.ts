import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { DOCUMENT_SCOPE } from './version-proposal-accept-provider-helpers-fixtures';
import type { InMemoryVersionStoreProvider } from './version-proposal-accept-provider-helpers-graph';

export function versionForProvider(
  provider: InMemoryVersionStoreProvider,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  options: { readonly proposalAcceptMergeApplyCapability?: boolean } = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, {
    provider,
    proposalWorkspaceService,
    ...(options.proposalAcceptMergeApplyCapability === false
      ? {}
      : { captureMergeCommit: unexpectedMergeCommitCapture }),
  });
  return new WorkbookVersionImpl(ctx);
}

async function unexpectedMergeCommitCapture(): Promise<never> {
  throw new Error('proposal accept capability fixture must not materialize merge commits');
}
