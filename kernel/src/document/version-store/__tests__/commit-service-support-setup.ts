import { createProviderBackedBranchLifecycleService } from '../branch-provider-service';
import { createWorkbookVersionCommitService } from '../commit-service';
import { createInMemoryVersionStoreProvider } from '../provider';

import { expectCommitSuccess, expectInitializeSuccess } from './commit-service-support-assertions';
import { DOCUMENT_SCOPE, VERSION_AUTHOR, initializeInput } from './commit-service-support-fixtures';
import { createNormalCommitCapture } from './commit-service-support-normal-captures';

export async function setupMergeInputs() {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const branchService = createProviderBackedBranchLifecycleService({ provider });
  const branch = await branchService.createBranch({
    name: 'scenario/incoming',
    targetCommitId: initialized.rootCommit.id,
    expectedAbsent: true,
    createdBy: VERSION_AUTHOR,
  });
  expect(branch.ok).toBe(true);
  if (!branch.ok)
    throw new Error(`expected incoming branch create success: ${branch.diagnostics[0]?.code}`);

  const oursService = createWorkbookVersionCommitService({
    provider,
    captureNormalCommit: createNormalCommitCapture('ours'),
  });
  const ours = await oursService.commit({
    expectedHead: {
      commitId: initialized.rootCommit.id as any,
      revision: initialized.initialHead.revision,
    },
  });
  expectCommitSuccess(ours);

  const theirsService = createWorkbookVersionCommitService({
    provider,
    captureNormalCommit: createNormalCommitCapture('theirs'),
  });
  const theirs = await theirsService.commit({
    targetRef: 'refs/heads/scenario/incoming' as any,
    expectedHead: {
      commitId: initialized.rootCommit.id as any,
      revision: branch.branch.ref.refVersion,
    },
  });
  expectCommitSuccess(theirs);

  return { provider, initialized, ours, theirs };
}
