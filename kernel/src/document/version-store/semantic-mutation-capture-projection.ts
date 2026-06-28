import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import {
  isDirectCellValueOperation,
  mapCellWriteChanges,
} from './semantic-mutation-cell-write-projection';
import {
  mapCfChanges,
  mapCommentChanges,
  mapFilterChanges,
  mapFloatingObjectChanges,
  mapNamedRangeChanges,
  mapRangeChanges,
  mapSortingChanges,
  mapTableChanges,
} from './semantic-mutation-capture-metadata-projection';
import type {
  PendingSemanticMutation,
  SemanticMutationCaptureProjectionInput,
  VersionSemanticChangeRecord,
} from './semantic-mutation-capture-projection-types';
import {
  isDirectCellFormatOperation,
  mapDirectCellFormatChanges,
} from './semantic-mutation-direct-format-capture';
import {
  COMPACT_CELL_VALUE_REVIEW_PROJECTION_MIN_CHANGE_COUNT,
  compactPlainCellValueReviewProjectionFromCellChanges,
} from './semantic-review-projection';
import {
  mapSheetCopyChanges,
  mapSheetCreateChanges,
  mapSheetFrozenPaneChanges,
  mapSheetMoveChanges,
  mapSheetRemoveChanges,
  mapSheetRenameChanges,
  mapSheetTabColorChanges,
  mapStructureChanges,
} from './semantic-mutation-sheet-projection';
import { mapSyncAuthoredCellChanges } from './semantic-mutation-sync-cell-capture';

export type {
  PendingSemanticMutation,
  SemanticMutationCaptureProjectionInput,
  VersionSemanticChangeRecord,
} from './semantic-mutation-capture-projection-types';

export { isDirectCellValueOperation } from './semantic-mutation-cell-write-projection';

const MUTATION_SEGMENT_INLINE_CHANGE_ID_LIMIT = 1_000;
const MUTATION_SEGMENT_INLINE_DIRECT_EDIT_LIMIT = 1_000;

export function compactCellWriteReviewProjectionForMutation(
  input: SemanticMutationCaptureProjectionInput,
) {
  if (!isDirectCellValueOperation(input.operation)) return null;
  return compactPlainCellValueReviewProjectionFromCellChanges({
    changedCells: input.result.recalc?.changedCells ?? [],
    directEdits: input.directEdits,
    directEditRanges: input.directEditRanges,
    minimumChangeCount: COMPACT_CELL_VALUE_REVIEW_PROJECTION_MIN_CHANGE_COUNT,
  });
}

export function mapMutationResultToSemanticChanges(
  input: SemanticMutationCaptureProjectionInput,
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  if (input.operation === 'compute_apply_sync_update')
    changes.push(...mapSyncAuthoredCellChanges(input.result.authoredCellChanges ?? [], sequence));
  if (isDirectCellValueOperation(input.operation)) {
    changes.push(
      ...mapCellWriteChanges(
        input.result.recalc?.changedCells ?? [],
        input.directEdits ?? [],
        input.directEditRanges ?? [],
        sequence,
      ),
    );
  }
  if (isDirectCellFormatOperation(input.operation, input.operationContext)) {
    changes.push(...mapDirectCellFormatChanges(input.result.propertyChanges ?? [], sequence));
  }
  if (input.operation === 'compute_rename_compute_sheet') {
    changes.push(...mapSheetRenameChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_set_tab_color') {
    changes.push(...mapSheetTabColorChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_set_frozen_panes') {
    changes.push(...mapSheetFrozenPaneChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_create_sheet_with_default_col_width') {
    changes.push(...mapSheetCreateChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_delete_sheet') {
    changes.push(...mapSheetRemoveChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_copy_sheet') {
    changes.push(...mapSheetCopyChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_move_sheet') {
    changes.push(...mapSheetMoveChanges(input.result.sheetChanges ?? [], sequence));
  }
  changes.push(...mapNamedRangeChanges(input.result.namedRangeChanges ?? [], sequence));
  changes.push(...mapTableChanges(input.result.tableChanges ?? [], sequence));
  changes.push(...mapCommentChanges(input.result.commentChanges ?? [], sequence));
  changes.push(...mapCfChanges(input.result.cfChanges ?? [], sequence));
  changes.push(...mapFilterChanges(input.result.filterChanges ?? [], sequence));
  changes.push(...mapSortingChanges(input.result.sortingChanges ?? [], sequence));
  changes.push(...mapFloatingObjectChanges(input.result.floatingObjectChanges ?? [], sequence));
  changes.push(...mapRangeChanges(input.result.rangeChanges ?? [], sequence));
  changes.push(...mapStructureChanges(input.result.structureChanges ?? [], sequence));
  return changes;
}

export function mutationSegmentPayload(record: PendingSemanticMutation): unknown {
  const changeIds = record.changes.map((change) => change.structural.changeId);
  const compactProjectionChangeCount = record.compactReviewProjection?.changeCount ?? 0;
  const changeIdCount =
    changeIds.length === 0 && compactProjectionChangeCount > 0
      ? compactProjectionChangeCount
      : changeIds.length;
  const directEditProjection = mutationSegmentDirectEditProjection(record);
  return {
    schemaVersion: 1,
    segmentId: `mutation-${record.sequence}`,
    operation: record.operation,
    capturedAt: record.capturedAt,
    ...(changeIdCount <= MUTATION_SEGMENT_INLINE_CHANGE_ID_LIMIT
      ? { changeIds }
      : {
          changeIds: [],
          changeIdCount,
          omittedChangeIds: {
            reason: 'large-change-set',
            count: changeIdCount,
          },
        }),
    ...directEditProjection,
    ...(record.directEditRanges.length === 0
      ? {}
      : {
          directEditRanges: record.directEditRanges.map((range) => ({
            ...range,
            address: `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`,
          })),
        }),
    ...(record.operationContext ? { operationContext: record.operationContext } : {}),
  };
}

function mutationSegmentDirectEditProjection(
  record: PendingSemanticMutation,
): Readonly<Record<string, unknown>> {
  const directEditCount = record.directEdits.length;
  if (directEditCount <= MUTATION_SEGMENT_INLINE_DIRECT_EDIT_LIMIT) {
    return {
      directEdits: record.directEdits.map((edit) => ({
        sheetId: edit.sheetId,
        row: edit.row,
        col: edit.col,
        address: toA1(edit.row, edit.col),
      })),
    };
  }

  const reason = directEditRangesCoverAll(record.directEdits, record.directEditRanges)
    ? 'covered-by-direct-edit-ranges'
    : 'large-change-set';
  return {
    directEdits: [],
    directEditCount,
    omittedDirectEdits: {
      reason,
      count: directEditCount,
    },
  };
}

function directEditRangesCoverAll(
  directEdits: PendingSemanticMutation['directEdits'],
  directEditRanges: PendingSemanticMutation['directEditRanges'],
): boolean {
  if (directEdits.length === 0 || directEditRanges.length === 0) return false;
  return directEdits.every((edit) =>
    directEditRanges.some(
      (range) =>
        range.sheetId === edit.sheetId &&
        edit.row >= range.startRow &&
        edit.row <= range.endRow &&
        edit.col >= range.startCol &&
        edit.col <= range.endCol,
    ),
  );
}

export function authorForRecords(
  records: readonly PendingSemanticMutation[],
  fallback: VersionAuthor,
): VersionAuthor {
  return records.find((record) => record.operationContext)?.operationContext?.author ?? fallback;
}
