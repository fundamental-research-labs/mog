import { expect } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  INDEXEDDB_PERSISTED_APPLY_DOCUMENT_ID as DOCUMENT_ID,
  INDEXEDDB_PERSISTED_APPLY_GRAPH_ID as GRAPH_ID,
  rootWrite,
} from './version-indexeddb-persisted-apply-test-utils';
import {
  expectCommit,
  expectHead,
  requireRefRevision,
} from './version-indexeddb-persisted-apply-test-helpers';
import type {
  PersistedFastForwardMergePreview,
  ProviderSelectionReopenFastForwardStage,
} from './version-indexeddb-persisted-apply-fast-forward-types';

const BRANCH_REF = 'scenario/indexeddb-persisted-incoming' as any;
const MAIN_REF = 'refs/heads/main' as any;

export async function stagePersistedFastForwardPreviewForProviderSelectionReopen(): Promise<ProviderSelectionReopenFastForwardStage> {
  const firstHandle = await DocumentFactory.create({
    documentId: DOCUMENT_ID,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let firstWb: Workbook | undefined;

  try {
    firstWb = await firstHandle.workbook({
      versioning: withVersionManifest({
        providerSelection: {
          kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
          requireDurablePersistence: true,
          initialize: {
            graphId: GRAPH_ID,
            rootWrite: await rootWrite('root'),
          },
        },
      }),
    });
    const rootHead = await expectHead(firstWb);

    await firstWb.activeSheet.setCell('A1', 'base');
    const baseCommit = await expectCommit(
      firstWb.version.commit({
        expectedHead: {
          commitId: rootHead.id,
          revision: requireRefRevision(rootHead),
        },
      }),
    );
    const baseHead = await expectHead(firstWb);

    await firstWb.activeSheet.setCell('B1', 'ours');
    const oursCommit = await expectCommit(
      firstWb.version.commit({
        expectedHead: {
          commitId: baseCommit.id,
          revision: requireRefRevision(baseHead),
        },
      }),
    );
    const oursHead = await expectHead(firstWb);

    const branch = await firstWb.version.createBranch({
      name: BRANCH_REF,
      targetCommitId: oursCommit.id,
      expectedAbsent: true,
    });
    if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

    await firstWb.activeSheet.setCell('C1', 'theirs');
    const theirsCommit = await expectCommit(
      firstWb.version.commit({
        targetRef: BRANCH_REF,
        expectedHead: {
          commitId: oursCommit.id,
          revision: branch.value.revision,
        },
      }),
    );

    const expectedTargetHead = {
      commitId: oursCommit.id,
      revision: requireRefRevision(oursHead),
    };
    const preview = await firstWb.version.merge(
      {
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      },
      {
        mode: 'preview',
        targetRef: MAIN_REF,
        expectedTargetHead,
        persistReviewRecord: true,
      },
    );
    if (!preview.ok)
      throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
    expect(preview.value).toMatchObject({
      status: 'fastForward',
      resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
      resultDigest: {
        algorithm: 'sha256',
        digest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      attemptPersistence: 'persisted',
      attemptKind: 'applyable',
    });
    if (
      preview.value.status !== 'fastForward' ||
      !preview.value.resultId ||
      !preview.value.resultDigest
    ) {
      throw new Error('expected persisted fast-forward preview to expose result id and digest');
    }

    const persistedPreview = preview.value as PersistedFastForwardMergePreview;

    await firstWb.close('skipSave');
    firstWb = undefined;
    await firstHandle.dispose();

    return {
      preview: persistedPreview,
      expectedTargetHead,
      oursCommitId: oursCommit.id,
      theirsCommitId: theirsCommit.id,
    };
  } finally {
    if (firstWb) await firstWb.close('skipSave');
    await firstHandle.dispose();
  }
}
