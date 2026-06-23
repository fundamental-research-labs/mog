import type {
  VersionApplyMergeResolution,
  VersionMergeConflict,
  Workbook,
  WorkbookCommitSummary,
  VersionHead,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import {
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  withVersionManifest,
} from './version-domain-support-test-utils';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc07-apply-merge-materializer';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion applyMerge production materializer', () => {
  it('creates a durable two-parent merge commit from real provider-backed workbook edits', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, mergedHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/incoming' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      await branchWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/incoming' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const preview = await sourceWb.version.merge({
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });
      expect(preview).toMatchObject({
        ok: true,
        value: {
          status: 'clean',
          changes: expect.arrayContaining([
            expect.objectContaining({
              structural: expect.objectContaining({ entityId: expect.stringMatching(/!B1$/) }),
            }),
            expect.objectContaining({
              structural: expect.objectContaining({ entityId: expect.stringMatching(/!C1$/) }),
            }),
          ]),
        },
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: oursCommit.id,
            revision: requireRefRevision(oursHead),
          },
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
      });

      const mergeCommitId = applied.value.commitRef.id;
      await expect(sourceWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: mergeCommitId,
              parents: [oursCommit.id, theirsCommit.id],
            }),
          ]),
        },
      });

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('creates a durable merge commit for a resolved same-cell conflict', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-conflict', 'root'),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const branchHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, branchHandle, mergedHandle);
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/conflict-incoming' as any,
        targetCommitId: baseCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('A1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      branchWb = await branchHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      installVersionDomainDetectorNoopsOnWorkbook(branchWb);
      await branchWb.activeSheet.setCell('A1', 'theirs');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/conflict-incoming' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      const preview = await sourceWb.version.merge({
        base: baseCommit.id,
        ours: oursCommit.id,
        theirs: theirsCommit.id,
      });
      if (!preview.ok) {
        throw new Error(`expected merge preview success: ${preview.error.code}`);
      }
      if (preview.value.status !== 'conflicted') {
        throw new Error(`expected conflicted merge preview, got ${preview.value.status}`);
      }
      expect(preview.value.conflicts).toHaveLength(1);
      expect(preview.value.conflicts[0]).toMatchObject({
        conflictKind: 'same-property',
        structural: expect.objectContaining({ entityId: expect.stringMatching(/!A1$/) }),
        base: { kind: 'value', value: 'base' },
        ours: { kind: 'value', value: 'ours' },
        theirs: { kind: 'value', value: 'theirs' },
      });

      const applied = await sourceWb.version.applyMerge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          resolutions: [resolutionFor(preview.value.conflicts[0], 'acceptTheirs')],
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead: {
            commitId: oursCommit.id,
            revision: requireRefRevision(oursHead),
          },
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resolutionCount: 1,
        mutationGuarantee: 'merge-commit-created',
      });

      const mergeCommitId = applied.value.commitRef.id;
      await expect(sourceWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({
              id: mergeCommitId,
              parents: [oursCommit.id, theirsCommit.id],
            }),
          ]),
        },
      });

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('applies a persisted fast-forward merge result to an existing descendant commit', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-fast-forward', 'root'),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const mergedHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle, mergedHandle);
    let sourceWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/fast-forward-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        sourceWb.version.commit({
          targetRef: 'scenario/fast-forward-incoming' as any,
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
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'fastForward',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
        targetRef: 'refs/heads/main',
      });
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected fast-forward preview to expose a persisted result id and digest');
      }

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'fastForwarded',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
          refRevision: { kind: 'counter', value: '3' },
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        resolutionSetDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        resolvedAttemptDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-fast-forwarded',
      });

      const repeated = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!repeated.ok)
        throw new Error(`expected repeated applyMerge success: ${repeated.error.code}`);
      expect(repeated.value).toMatchObject({
        status: 'alreadyApplied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        commitRef: {
          id: theirsCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: theirsCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const fastForwardedHead = await expectHead(sourceWb);
      await sourceWb.activeSheet.setCell('D1', 'after-terminal');
      const afterTerminalCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: theirsCommit.id,
            revision: requireRefRevision(fastForwardedHead),
          },
        }),
      );
      const staleTerminal = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!staleTerminal.ok) {
        throw new Error(`expected stale terminal applyMerge result: ${staleTerminal.error.code}`);
      }
      expect(staleTerminal.value).toMatchObject({
        status: 'staleTargetHead',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: afterTerminalCommit.id,
        changes: [],
        mutationGuarantee: 'ref-not-mutated',
      });

      const commits = await sourceWb.version.listCommits();
      if (!commits.ok) throw new Error(`expected listCommits success: ${commits.error.code}`);
      expect(commits.value.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: theirsCommit.id,
            parents: [oursCommit.id],
          }),
        ]),
      );
      expect(
        commits.value.items.some(
          (item) => item.parents[0] === oursCommit.id && item.parents[1] === theirsCommit.id,
        ),
      ).toBe(false);

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(mergedWb);
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: theirsCommit.id,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected fast-forwarded checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'base' });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: 'theirs' });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('applies a persisted already-merged result without moving the target ref', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-already-merged', 'root'),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle);
    let sourceWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);
      const expectedTargetHead = {
        commitId: oursCommit.id,
        revision: requireRefRevision(oursHead),
      };

      const preview = await sourceWb.version.merge(
        {
          base: initialized.rootCommit.id,
          ours: oursCommit.id,
          theirs: baseCommit.id,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected already-merged preview success: ${preview.error.code}`);
      expect(preview.value).toMatchObject({
        status: 'alreadyMerged',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
        resultDigest: {
          algorithm: 'sha256',
          digest: expect.stringMatching(/^[0-9a-f]{64}$/),
        },
        attemptPersistence: 'persisted',
        attemptKind: 'applyable',
        targetRef: 'refs/heads/main',
      });
      if (
        preview.value.status !== 'alreadyMerged' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error(
          'expected already-merged preview to expose a persisted result id and digest',
        );
      }

      const applied = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok)
        throw new Error(`expected already-merged apply success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'alreadyMerged',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        commitRef: {
          id: oursCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'refs/heads/main',
        },
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: oursCommit.id,
        changes: [],
        resolutionCount: 0,
        mutationGuarantee: 'ref-not-mutated',
      });

      const head = await expectHead(sourceWb);
      expect(head).toMatchObject({
        id: oursCommit.id,
        refRevision: requireRefRevision(oursHead),
      });

      await sourceWb.activeSheet.setCell('C1', 'after-already-merged');
      const afterAlreadyMergedCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: oursCommit.id,
            revision: requireRefRevision(head),
          },
        }),
      );
      const staleTerminal = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      if (!staleTerminal.ok) {
        throw new Error(
          `expected stale already-merged terminal result: ${staleTerminal.error.code}`,
        );
      }
      expect(staleTerminal.value).toMatchObject({
        status: 'staleTargetHead',
        ours: oursCommit.id,
        theirs: baseCommit.id,
        resultId: preview.value.resultId,
        resultDigest: preview.value.resultDigest,
        targetRef: 'refs/heads/main',
        headBefore: oursCommit.id,
        headAfter: afterAlreadyMergedCommit.id,
        changes: [],
        mutationGuarantee: 'ref-not-mutated',
      });
    } finally {
      if (sourceWb) await sourceWb.close('skipSave');
      await sourceHandle.dispose();
    }
  });

  it('rejects a persisted fast-forward result when the target head moved after preview', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-stale-fast-forward', 'root'),
    );
    expectInitializeSuccess(initialized);

    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    installVersionDomainDetectorNoopsOnHandles(sourceHandle);
    let sourceWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(sourceWb);
      await sourceWb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      const baseHead = await expectHead(sourceWb);

      await sourceWb.activeSheet.setCell('B1', 'ours');
      const oursCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: {
            commitId: baseCommit.id,
            revision: requireRefRevision(baseHead),
          },
        }),
      );
      const oursHead = await expectHead(sourceWb);

      const branch = await sourceWb.version.createBranch({
        name: 'scenario/stale-fast-forward-incoming' as any,
        targetCommitId: oursCommit.id,
        expectedAbsent: true,
      });
      if (!branch.ok) throw new Error(`expected branch create success: ${branch.error.code}`);

      await sourceWb.activeSheet.setCell('C1', 'theirs');
      const theirsCommit = await expectCommit(
        sourceWb.version.commit({
          targetRef: 'scenario/stale-fast-forward-incoming' as any,
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
      const preview = await sourceWb.version.merge(
        {
          base: baseCommit.id,
          ours: oursCommit.id,
          theirs: theirsCommit.id,
        },
        {
          mode: 'preview',
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
          persistReviewRecord: true,
        },
      );
      if (!preview.ok)
        throw new Error(`expected persisted merge preview success: ${preview.error.code}`);
      if (
        preview.value.status !== 'fastForward' ||
        !preview.value.resultId ||
        !preview.value.resultDigest
      ) {
        throw new Error('expected fast-forward preview to expose a persisted result id and digest');
      }

      await sourceWb.activeSheet.setCell('D1', 'interloper');
      const interloperCommit = await expectCommit(
        sourceWb.version.commit({
          expectedHead: expectedTargetHead,
        }),
      );

      const stale = await sourceWb.version.applyMerge(
        {
          resultId: preview.value.resultId,
          resultDigest: preview.value.resultDigest,
        },
        {
          targetRef: 'refs/heads/main' as any,
          expectedTargetHead,
        },
      );
      expect(stale).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.applyMerge',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: 'VERSION_REF_CONFLICT' }),
          ]),
        },
      });

      const head = await expectHead(sourceWb);
      expect(head).toMatchObject({
        id: interloperCommit.id,
        refRevision: { kind: 'counter', value: '3' },
      });
    } finally {
      if (sourceWb) await sourceWb.close('skipSave');
      await sourceHandle.dispose();
    }
  });
});

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${result.error.code}`);
  return result.value;
}

async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${result.error.code}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`expected conflict to expose ${kind} resolution option`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
