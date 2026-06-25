import { expect, it, jest } from '@jest/globals';
import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../context';
import { DocumentFactory } from '../../document/document-factory';
import type { DocumentHandleInternal } from '../../document/document-handle-types';
import {
  createMaterializerMergeFixture,
  MATERIALIZER_TARGET_REF,
} from './version-apply-merge-materializer-scenario-helpers';

export function describeCleanMaterializerMergeScenario(): void {
  it('creates a durable two-parent merge commit from real provider-backed workbook edits', async () => {
    const fixture = await createMaterializerMergeFixture({
      graphId: 'graph-1',
      branchName: 'scenario/incoming',
      baseEdits: [['A1', 'base']],
      oursEdits: [['B1', 'ours']],
      theirsEdits: [['C1', 'theirs']],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
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
          targetRef: MATERIALIZER_TARGET_REF as any,
          expectedTargetHead,
        },
      );
      if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
      expect(applied.value).toMatchObject({
        status: 'applied',
        ours: oursCommit.id,
        theirs: theirsCommit.id,
        mutationGuarantee: 'merge-commit-created',
        commitRef: {
          refName: MATERIALIZER_TARGET_REF,
          resolvedFrom: MATERIALIZER_TARGET_REF,
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

      await expect(sourceWb.version.getSurfaceStatus()).resolves.toMatchObject({
        current: {
          checkedOutCommitId: oursCommit.id,
          currentRefHeadId: mergeCommitId,
          refHeadAtMaterialization: mergeCommitId,
          stale: true,
          staleReason: 'activeSessionBehind',
        },
      });

      const mergedWb = await fixture.openMergedWorkbook();
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
      await fixture.cleanup();
    }
  });

  it('keeps no-op merge semantic entries in the public diff while skipping physical no-op writes', async () => {
    const fixture = await createMaterializerMergeFixture({
      graphId: 'graph-noop-semantic',
      branchName: 'scenario/noop-semantic-incoming',
      baseEdits: [['A1', 'base']],
      oursEdits: [
        ['A1', 'shared'],
        ['B1', 'ours-only'],
      ],
      theirsEdits: [
        ['A1', 'shared'],
        ['C1', 'theirs-write'],
      ],
    });

    try {
      const { sourceWb, baseCommit, oursCommit, theirsCommit, expectedTargetHead } = fixture;
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
        conflicts: [],
        changes: expect.arrayContaining([
          expect.objectContaining({
            structural: expect.objectContaining({ entityId: expect.stringMatching(/!A1$/) }),
            merged: { kind: 'value', value: 'shared' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ entityId: expect.stringMatching(/!B1$/) }),
            merged: { kind: 'value', value: 'ours-only' },
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ entityId: expect.stringMatching(/!C1$/) }),
            merged: { kind: 'value', value: 'theirs-write' },
          }),
        ]),
      });

      const writeProbe = installMergeMaterializationCellWriteProbe();
      let mergeCommitId: WorkbookCommitId | undefined;
      try {
        const applied = await sourceWb.version.applyMerge(
          {
            base: baseCommit.id,
            ours: oursCommit.id,
            theirs: theirsCommit.id,
          },
          {
            targetRef: MATERIALIZER_TARGET_REF as any,
            expectedTargetHead,
          },
        );
        if (!applied.ok) throw new Error(`expected applyMerge success: ${applied.error.code}`);
        expect(applied.value).toMatchObject({
          status: 'applied',
          ours: oursCommit.id,
          theirs: theirsCommit.id,
          mutationGuarantee: 'merge-commit-created',
        });
        mergeCommitId = applied.value.commitRef.id;
      } finally {
        writeProbe.restore();
      }
      if (!mergeCommitId) throw new Error('expected applyMerge to return a merge commit id');

      expect(writeProbe.cellWrites()).toEqual([
        expect.objectContaining({
          edits: [expect.objectContaining({ row: 0, col: 2 })],
        }),
      ]);

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

      const mergedWb = await fixture.openMergedWorkbook();
      const diff = await mergedWb.version.diff(baseCommit.id, mergeCommitId);
      if (!diff.ok) {
        throw new Error(
          `expected merge diff success: ${diff.error.code} ${JSON.stringify(
            diff.error.diagnostics,
          )}`,
        );
      }
      expect(
        diff.value.items.map((item) => ({
          entityId: item.structural.kind === 'metadata' ? item.structural.entityId : null,
          after: item.after.kind === 'value' ? item.after.value : null,
        })),
      ).toEqual(
        expect.arrayContaining([
          { entityId: expect.stringMatching(/!A1$/), after: 'shared' },
          { entityId: expect.stringMatching(/!B1$/), after: 'ours-only' },
          { entityId: expect.stringMatching(/!C1$/), after: 'theirs-write' },
        ]),
      );

      const checkoutMerged = await mergedWb.version.checkout({
        kind: 'commit',
        id: mergeCommitId,
      });
      if (!checkoutMerged.ok) {
        throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
      }
      await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 'shared',
      });
      await expect(mergedWb.activeSheet.getCell('B1')).resolves.toMatchObject({
        value: 'ours-only',
      });
      await expect(mergedWb.activeSheet.getCell('C1')).resolves.toMatchObject({
        value: 'theirs-write',
      });
    } finally {
      await fixture.cleanup();
    }
  });
}

type MaterializationCellWrite = {
  readonly sheetId: string;
  readonly edits: readonly {
    readonly row: number;
    readonly col: number;
  }[];
};

function installMergeMaterializationCellWriteProbe(): {
  readonly cellWrites: () => readonly MaterializationCellWrite[];
  readonly restore: () => void;
} {
  const cellWrites: MaterializationCellWrite[] = [];
  const createDocument = DocumentFactory.create.bind(DocumentFactory);
  const spy = jest.spyOn(DocumentFactory, 'create');
  spy.mockImplementation(async (options?: any) => {
    const handle = await createDocument(options);
    if (isMergeMaterializationCreateOptions(options)) {
      const context = (handle as Partial<DocumentHandleInternal>).context as
        | DocumentContext
        | undefined;
      const bridge = context?.computeBridge as
        | {
            setCellsByPosition?: (
              sheetId: unknown,
              edits: readonly { readonly row?: unknown; readonly col?: unknown }[],
              options?: unknown,
            ) => Promise<unknown>;
          }
        | undefined;
      if (bridge?.setCellsByPosition) {
        const setCellsByPosition = bridge.setCellsByPosition.bind(bridge);
        bridge.setCellsByPosition = async (sheetId, edits, options) => {
          cellWrites.push({
            sheetId: String(sheetId),
            edits: edits.flatMap((edit) =>
              typeof edit.row === 'number' && typeof edit.col === 'number'
                ? [{ row: edit.row, col: edit.col }]
                : [],
            ),
          });
          return setCellsByPosition(sheetId, edits, options);
        };
      }
    }
    return handle;
  });
  return {
    cellWrites: () => cellWrites,
    restore: () => spy.mockRestore(),
  };
}

function isMergeMaterializationCreateOptions(value: unknown): value is {
  readonly documentId: string;
  readonly internal: true;
} {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly internal?: unknown }).internal === true &&
    typeof (value as { readonly documentId?: unknown }).documentId === 'string' &&
    (value as { readonly documentId: string }).documentId.startsWith('version-merge-')
  );
}
