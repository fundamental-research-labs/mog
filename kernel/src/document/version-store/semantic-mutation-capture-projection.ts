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
  return {
    schemaVersion: 1,
    segmentId: `mutation-${record.sequence}`,
    operation: record.operation,
    capturedAt: record.capturedAt,
    changeIds: record.changes.map((change) => change.structural.changeId),
    directEdits: record.directEdits.map((edit) => ({
      sheetId: edit.sheetId,
      row: edit.row,
      col: edit.col,
      address: toA1(edit.row, edit.col),
    })),
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

export function authorForRecords(
  records: readonly PendingSemanticMutation[],
  fallback: VersionAuthor,
): VersionAuthor {
  return records.find((record) => record.operationContext)?.operationContext?.author ?? fallback;
}
