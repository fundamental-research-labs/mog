import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../../../context';
import type { VersionMergeCommitCaptureInput } from '../../../../document/version-store/commit-service';
import * as SheetOps from '../../../workbook/operations/sheet-crud-operations';
import * as CellOps from '../../../worksheet/operations/cell-operations';
import * as FormatOps from '../../../worksheet/operations/format-operations';
import type {
  ParsedMergeChange,
  ParsedRowColumnMergeChange,
  RowColumnTransition,
} from './materialization-plan/version-merge-materialization-plan';
import { DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND } from '../merge/version-merge-materializer-support';

export const MERGE_CAPTURE_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'mog.version-merge',
  actorKind: 'system',
  displayName: 'Mog Version Merge',
});

export async function applyMergeChanges(
  ctx: DocumentContext,
  input: VersionMergeCommitCaptureInput,
  changes: readonly ParsedMergeChange[],
  createdAt: string,
): Promise<void> {
  await applyRowColumnMergeChanges(
    ctx,
    input,
    changes.filter(
      (change): change is ParsedRowColumnMergeChange => change.kind === 'rowColumnOrder',
    ),
    createdAt,
  );

  for (const change of changes) {
    if (change.kind === 'rowColumnOrder') continue;
    if (!change.write) continue;
    const operationContext = mergeOperationContext(input, change, createdAt);
    const sheet = toSheetId(change.sheetId);
    if (change.kind === 'sheetMetadata') {
      if (change.merged.property === 'name') {
        await SheetOps.renameSheet(ctx, sheet, change.merged.value, { operationContext });
        continue;
      }
      if (change.merged.property === 'frozen') {
        await ctx.computeBridge.setFrozenPanes(sheet, change.merged.rows, change.merged.cols, {
          operationContext,
        });
        continue;
      }
      await ctx.computeBridge.setTabColor(sheet, change.merged.value, { operationContext });
      continue;
    }
    if (change.kind === 'directCellFormat') {
      if (change.merged.kind === 'clear') {
        const result = await FormatOps.clearFormat(ctx, sheet, change.row, change.col, {
          operationContext,
        });
        assertFormatOperationSuccess(result, 'clearFormat');
        continue;
      }
      const result = await FormatOps.setCellProperties(
        ctx,
        sheet,
        [{ row: change.row, col: change.col, format: change.merged.format }],
        { operationContext },
      );
      assertFormatOperationSuccess(result, 'setCellProperties');
      continue;
    }
    if (change.merged.kind === 'formula') {
      await CellOps.setCell(ctx, sheet, change.row, change.col, change.merged.formula, {
        operationContext,
      });
      continue;
    }
    await CellOps.setCell(
      ctx,
      sheet,
      change.row,
      change.col,
      change.merged.kind === 'clear' ? null : change.merged.value,
      { operationContext },
    );
  }
}

export function mergeMutationSegmentPayload(
  input: VersionMergeCommitCaptureInput,
  changes: readonly ParsedMergeChange[],
  createdAt: string,
): unknown {
  return {
    schemaVersion: 1,
    segmentId: `merge-${shortCommitId(input.ours)}-${shortCommitId(input.theirs)}`,
    operation: 'version.applyMerge',
    operationContext: {
      operationId: `version-merge:${shortCommitId(input.ours)}:${shortCommitId(input.theirs)}`,
      kind: 'merge',
      author: MERGE_CAPTURE_AUTHOR,
      createdAt,
      workbookId: input.namespace.documentId,
      sheetIds: Array.from(new Set(changes.map((change) => change.sheetId))).sort(),
      domainIds: Array.from(new Set(changes.map((change) => change.structural.domain))).sort(),
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
    capturedAt: createdAt,
    baseCommitId: input.base,
    oursCommitId: input.ours,
    theirsCommitId: input.theirs,
    targetRef: input.targetRef,
    expectedTargetHead: input.expectedTargetHead,
    resolutionCount: input.resolutionCount,
    materializer: DEFAULT_MERGE_COMMIT_MATERIALIZER_KIND,
    changeIds: changes.map((change) => change.structural.changeId),
    directEdits: changes.flatMap((change) =>
      change.kind === 'rowColumnOrder' || change.kind === 'sheetMetadata'
        ? []
        : [
            {
              sheetId: change.sheetId,
              row: change.row,
              col: change.col,
              address: change.address,
            },
          ],
    ),
    structureEdits: changes.flatMap((change) =>
      change.kind === 'rowColumnOrder' && change.transition.kind !== 'noop'
        ? [
            {
              sheetId: change.sheetId,
              axis: change.axis,
              index: change.index,
              action: change.transition.kind,
            },
          ]
        : [],
    ),
    sheetEdits: changes.flatMap((change) =>
      change.kind === 'sheetMetadata'
        ? [
            {
              sheetId: change.sheetId,
              property: change.merged.property,
              value:
                change.merged.property === 'frozen'
                  ? { rows: change.merged.rows, cols: change.merged.cols }
                  : change.merged.value,
            },
          ]
        : [],
    ),
  };
}

async function applyRowColumnMergeChanges(
  ctx: DocumentContext,
  input: VersionMergeCommitCaptureInput,
  changes: readonly ParsedRowColumnMergeChange[],
  createdAt: string,
): Promise<void> {
  const applicable = changes.filter(
    (
      change,
    ): change is ParsedRowColumnMergeChange & {
      readonly transition: Extract<RowColumnTransition, { readonly kind: 'insert' | 'delete' }>;
    } => change.transition.kind === 'insert' || change.transition.kind === 'delete',
  );
  const ordered = [
    ...applicable
      .filter((change) => change.transition.kind === 'delete')
      .sort(compareRowColumnDeleteChanges),
    ...applicable
      .filter((change) => change.transition.kind === 'insert')
      .sort(compareRowColumnInsertChanges),
  ];

  for (const change of ordered) {
    await ctx.computeBridge.structureChange(
      toSheetId(change.transition.sheetId),
      rowColumnStructureChange(change.transition),
      { operationContext: mergeOperationContext(input, change, createdAt) },
    );
  }
}

function rowColumnStructureChange(
  transition: Extract<RowColumnTransition, { readonly kind: 'insert' | 'delete' }>,
): Parameters<DocumentContext['computeBridge']['structureChange']>[1] {
  if (transition.axis === 'row') {
    return transition.kind === 'insert'
      ? { InsertRows: { at: transition.index, count: 1, new_row_ids: [] } }
      : { DeleteRows: { at: transition.index, count: 1, deleted_cell_ids: [] } };
  }
  return transition.kind === 'insert'
    ? { InsertCols: { at: transition.index, count: 1, new_col_ids: [] } }
    : { DeleteCols: { at: transition.index, count: 1, deleted_cell_ids: [] } };
}

function compareRowColumnDeleteChanges(
  left: ParsedRowColumnMergeChange & {
    readonly transition: Extract<RowColumnTransition, { readonly kind: 'insert' | 'delete' }>;
  },
  right: ParsedRowColumnMergeChange & {
    readonly transition: Extract<RowColumnTransition, { readonly kind: 'insert' | 'delete' }>;
  },
): number {
  return (
    compareStrings(left.sheetId, right.sheetId) ||
    compareStrings(left.axis, right.axis) ||
    right.index - left.index ||
    left.itemIndex - right.itemIndex
  );
}

function compareRowColumnInsertChanges(
  left: ParsedRowColumnMergeChange & {
    readonly transition: Extract<RowColumnTransition, { readonly kind: 'insert' | 'delete' }>;
  },
  right: ParsedRowColumnMergeChange & {
    readonly transition: Extract<RowColumnTransition, { readonly kind: 'insert' | 'delete' }>;
  },
): number {
  return (
    compareStrings(left.sheetId, right.sheetId) ||
    compareStrings(left.axis, right.axis) ||
    left.index - right.index ||
    left.itemIndex - right.itemIndex
  );
}

function assertFormatOperationSuccess(
  result: { readonly success: boolean; readonly error?: unknown },
  operation: string,
): void {
  if (!result.success) {
    throw new Error(`${operation} failed during version merge materialization`);
  }
}

function mergeOperationContext(
  input: VersionMergeCommitCaptureInput,
  change: ParsedMergeChange,
  createdAt: string,
): VersionOperationContext {
  return Object.freeze({
    operationId: `version-merge:${shortCommitId(input.ours)}:${shortCommitId(input.theirs)}:${change.itemIndex}`,
    kind: 'merge' as const,
    author: MERGE_CAPTURE_AUTHOR,
    createdAt,
    workbookId: input.namespace.documentId,
    sheetIds: [change.sheetId],
    domainIds: [change.structural.domain],
    groupId: `version-merge:${shortCommitId(input.base)}:${shortCommitId(input.ours)}:${shortCommitId(input.theirs)}`,
    capturePolicy: 'commitEligible' as const,
    writeAdmissionMode: 'capture' as const,
  });
}

function shortCommitId(commitId: string): string {
  return commitId.replace(/^commit:sha256:/, '').slice(0, 12);
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
