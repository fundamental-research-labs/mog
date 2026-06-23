import { jest } from '@jest/globals';

import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { WorkbookCommitCompletenessDiagnostic } from '../../../document/version-store/commit-store';
import type { VersionGraphInitializeResult } from '../../../document/version-store/provider';
import {
  createSemanticDiffCommitCapture,
  expectInitializeSuccess,
  initializeInput,
} from './version-diff-provider-fixtures';
import { createDiffProvider } from './version-diff-provider-test-utils-provider';
import {
  createWorkbook,
  type DiffProviderTestWorkbook,
} from './version-diff-provider-test-utils-workbook';

type InitializedVersionGraph = Extract<VersionGraphInitializeResult, { status: 'success' }>;
type CommitResult = Awaited<ReturnType<DiffProviderTestWorkbook['version']['commit']>>;
type SuccessfulCommit = Extract<CommitResult, { ok: true }>['value'];
type DiffOptions = Parameters<DiffProviderTestWorkbook['version']['diff']>[2];

export interface CommittedDiffWorkbook {
  readonly provider: ReturnType<typeof createDiffProvider>;
  readonly initialized: InitializedVersionGraph;
  readonly wb: DiffProviderTestWorkbook;
  readonly committed: SuccessfulCommit;
}

export async function createCommittedDiffWorkbook(
  input: {
    readonly graphId?: string;
    readonly rootLabel?: string;
    readonly commitLabel?: string;
    readonly changes?: readonly unknown[];
    readonly completenessDiagnostics?: readonly WorkbookCommitCompletenessDiagnostic[];
    readonly reviewChanges?: readonly unknown[];
    readonly captureNormalCommit?: VersionNormalCommitCapture;
  } = {},
): Promise<CommittedDiffWorkbook> {
  const provider = createDiffProvider();
  const initialized = await provider.initializeGraph(
    await initializeInput(input.graphId ?? 'graph-1', input.rootLabel ?? 'root'),
  );
  expectInitializeSuccess(initialized);

  const commitLabel = input.commitLabel ?? 'child';
  const captureNormalCommit =
    input.captureNormalCommit ??
    jest.fn(
      createSemanticDiffCommitCapture(
        commitLabel,
        input.changes,
        input.completenessDiagnostics,
        input.reviewChanges === undefined ? {} : { reviewChanges: input.reviewChanges },
      ),
    );
  const wb = createWorkbook({
    versioning: {
      provider,
      captureNormalCommit,
    },
  });

  const commitResult = await wb.version.commit({
    expectedHead: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
      symbolicHeadRevision: initialized.symbolicHead.revision,
    },
  });
  if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);

  return {
    provider,
    initialized,
    wb,
    committed: commitResult.value,
  };
}

export function diffCommitted(context: CommittedDiffWorkbook, options?: DiffOptions) {
  return context.wb.version.diff(context.initialized.rootCommit.id, context.committed.id, options);
}
