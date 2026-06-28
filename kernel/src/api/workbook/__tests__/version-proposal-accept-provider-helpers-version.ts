import type { ProposalWorkspaceLifecycleService } from '../../../document/version-store/proposals/proposal-workspace-lifecycle-service';
import type { VersionMergeCommitCapture } from '../../../document/version-store/commit-service';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { versionDomainSupportManifestRuntime } from './version-domain-support-test-utils';
import { DOCUMENT_SCOPE } from './version-proposal-accept-provider-helpers-fixtures';
import type { InMemoryVersionStoreProvider } from './version-proposal-accept-provider-helpers-graph';

export function versionForProvider(
  provider: InMemoryVersionStoreProvider,
  proposalWorkspaceService: ProposalWorkspaceLifecycleService,
  options: {
    readonly proposalAcceptMergeApplyCapability?: boolean;
    readonly captureMergeCommit?: VersionMergeCommitCapture;
  } = {},
): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, {
    provider,
    proposalWorkspaceService,
    ...versionDomainSupportManifestRuntime(),
    ...(options.proposalAcceptMergeApplyCapability === false
      ? {}
      : { captureMergeCommit: options.captureMergeCommit ?? unexpectedMergeCommitCapture }),
  });
  return new WorkbookVersionImpl(ctx);
}

async function unexpectedMergeCommitCapture(): Promise<never> {
  throw new Error('proposal accept capability fixture must not materialize merge commits');
}
