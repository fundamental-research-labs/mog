import type {
  VersionHead,
  VersionMergeChange,
  VersionMergeResult,
  VersionSemanticValue,
  Workbook,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
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

const DOCUMENT_ID = 'vc07-apply-merge-format';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-21T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion applyMerge direct formats and expanded domains', () => {
  it('materializes clean same-cell value and direct-format changes', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = expectInitializeSuccess(
      await provider.initializeGraph(await initializeInput('graph-format-clean', 'root')),
    );

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
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: withVersionManifest({ provider }) });
      await sourceWb.activeSheet.setCell('B1', 'base-seed');
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
        name: 'scenario/format-incoming' as any,
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
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.formats.set('A1', { bold: true, fontColor: '#FF0000' });
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/format-incoming' as any,
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
      expect(preview.value).toMatchObject({
        status: 'clean',
        changes: [
          expect.objectContaining({
            structural: expect.objectContaining({
              entityId: expect.stringMatching(/!A1$/),
            }),
            merged: { kind: 'value', value: 'ours' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'cells.formats.direct',
              entityId: expect.stringMatching(/!A1$/),
              propertyPath: ['format'],
            }),
          }),
        ],
        conflicts: [],
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
        resolutionCount: 0,
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
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'ours',
        format: expect.objectContaining({ bold: true, fontColor: '#FF0000' }),
      });
      await expect(mergedWb.activeSheet.formats.get('A1')).resolves.toMatchObject({
        bold: true,
        fontColor: '#FF0000',
      });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'base-seed',
      });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('materializes direct first-slice formulas and all row/column order transitions from a clean plan', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = expectInitializeSuccess(
      await provider.initializeGraph(await initializeInput('graph-expanded-domain-clean', 'root')),
    );

    let previewResult: VersionMergeResult | undefined;
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
    let sourceWb: Workbook | undefined;
    let branchWb: Workbook | undefined;
    let mergedWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({
        versioning: withVersionManifest({
          provider,
          mergeService: {
            merge: async () => {
              if (!previewResult) throw new Error('expected synthetic merge result');
              return previewResult;
            },
          },
        }),
      });
      const sheetId = String(sourceWb.activeSheet.sheetId);
      await sourceWb.activeSheet.setCell('A1', 1);
      await sourceWb.activeSheet.setCell('A2', 'shifted');
      await sourceWb.activeSheet.setCell('A4', 'deleted-row');
      await sourceWb.activeSheet.setCell('A6', 'insert-shifted-row');
      await sourceWb.activeSheet.setCell('C1', 'deleted-column');
      await sourceWb.activeSheet.setCell('F1', 'insert-shifted-column');
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
        name: 'scenario/expanded-domain-incoming' as any,
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
      const checkoutBase = await branchWb.version.checkout({ kind: 'commit', id: baseCommit.id });
      if (!checkoutBase.ok) {
        throw new Error(`expected branch workbook checkout success: ${checkoutBase.error.code}`);
      }
      await branchWb.activeSheet.setCell('E1', 'theirs-anchor');
      const theirsCommit = await expectCommit(
        branchWb.version.commit({
          targetRef: 'scenario/expanded-domain-incoming' as any,
          expectedHead: {
            commitId: baseCommit.id,
            revision: branch.value.revision,
          },
        }),
      );

      previewResult = cleanMergeResult(baseCommit.id, oursCommit.id, theirsCommit.id, [
        formulaChange('merge-formula-a2', sheetId, 'A2', '=A1+1'),
        rowColumnChange('merge-row-insert', sheetId, 'row', 1, 'insert'),
        rowColumnChange('merge-row-delete', sheetId, 'row', 3, 'delete'),
        rowColumnChange('merge-column-insert', sheetId, 'column', 4, 'insert'),
        rowColumnChange('merge-column-delete', sheetId, 'column', 2, 'delete'),
      ]);

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
        resolutionCount: 0,
        mutationGuarantee: 'merge-commit-created',
      });

      mergedWb = await mergedHandle.workbook({ versioning: withVersionManifest({ provider }) });
      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: applied.value.commitRef.id,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 1 });
      await expect(mergedWb.activeSheet.getFormula('A2')).resolves.toBe('=A1+1');
      await expect(mergedWb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: 2 });
      await expect(mergedWb.activeSheet.getCell('A3')).resolves.toMatchObject({
        value: 'shifted',
      });
      await expect(mergedWb.activeSheet.getCell('A4')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('A5')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('A6')).resolves.toMatchObject({
        value: 'insert-shifted-row',
      });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({ value: 'ours' });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('E1')).resolves.toMatchObject({ value: null });
      await expect(mergedWb.activeSheet.getCell('F1')).resolves.toMatchObject({
        value: 'insert-shifted-column',
      });
    } finally {
      if (mergedWb) await mergedWb.close('skipSave');
      if (branchWb) await branchWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await mergedHandle.dispose();
      await branchHandle.dispose();
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
): Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}

function cleanMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  changes: readonly VersionMergeChange[],
): VersionMergeResult {
  return {
    status: 'clean',
    base,
    ours,
    theirs,
    changes,
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'preview-only',
  };
}

function formulaChange(
  changeId: string,
  sheetId: string,
  address: string,
  formula: string,
): VersionMergeChange {
  const value: VersionSemanticValue = { kind: 'formula', formula };
  return {
    structural: metadata(changeId, `${sheetId}!${address}`, 'cells.formulas', ['formula']),
    base: { kind: 'value', value: null },
    theirs: { kind: 'value', value },
    merged: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  };
}

function rowColumnChange(
  changeId: string,
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
  action: 'insert' | 'delete',
): VersionMergeChange {
  const value = rowColumnValue(sheetId, axis, index);
  const present = { kind: 'value' as const, value };
  const absent = { kind: 'value' as const, value: null };
  return {
    structural: metadata(changeId, `${sheetId}!${axis}:${index}`, 'rows-columns', ['order']),
    base: action === 'insert' ? absent : present,
    theirs: action === 'insert' ? present : absent,
    merged: action === 'insert' ? present : absent,
    display: { address: { kind: 'value', value: displayRef(axis, index) } },
  };
}

function rowColumnValue(
  sheetId: string,
  axis: 'row' | 'column',
  index: number,
): VersionSemanticValue {
  return {
    kind: 'object',
    fields: [
      { key: 'axis', value: axis },
      { key: 'sheetId', value: sheetId },
      { key: 'index', value: index },
      { key: 'displayRef', value: displayRef(axis, index) },
    ],
  };
}

function displayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') {
    const label = String(index + 1);
    return `${label}:${label}`;
  }
  const label = columnLabel(index);
  return `${label}:${label}`;
}

function columnLabel(index: number): string {
  let remaining = index;
  let label = '';
  do {
    label = String.fromCharCode(65 + (remaining % 26)) + label;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return label;
}

function metadata(
  changeId: string,
  entityId: string,
  domain: string,
  propertyPath: readonly string[],
) {
  return {
    kind: 'metadata' as const,
    changeId,
    domain,
    entityId,
    propertyPath,
  };
}
