import type { RenderRegion } from '@mog/canvas-engine';
import type { CellRange, FormattedText } from '@mog-sdk/contracts/core';
import { displayString } from '@mog-sdk/contracts/core';
import type {
  CellDataSource,
  GridRegionMeta,
  InteractiveElementCollector,
  SelectionDataSource,
} from '@mog-sdk/contracts/rendering';

import type { ViewportMergeIndex } from '../coordinates/viewport-merge-index';
import type { ViewportPositionIndex } from '../coordinates/viewport-position-index';
import { forEachVisibleCell } from '../layout/for-each-visible-cell';
import { docToRegionXY } from '../shared/cell-bounds';
import { collectInteractiveElements } from './interactive-elements';
import type { CellRenderInfo } from './types';

interface InteractiveCellReader {
  moveTo(row: number, col: number): boolean;
  readonly hasComment: boolean;
  readonly isCheckbox: boolean;
  readonly valueType: number;
  readonly numberValue: number;
  readonly displayText: FormattedText | null;
}

function isReaderCheckboxChecked(reader: InteractiveCellReader): boolean {
  if (reader.valueType === 3) return reader.numberValue !== 0;
  if (reader.valueType === 1) return reader.numberValue === 1;
  return reader.displayText ? displayString(reader.displayText) === 'TRUE' : false;
}

/**
 * Rebuild DOM-overlay interactive elements from the full visible range.
 *
 * Dirty cell painting may only visit a subset of cells, but the collector is
 * frame-scoped and must represent every currently visible interactive element.
 */
export function collectVisibleInteractiveElements(
  sheetId: string,
  cellRange: CellRange,
  region: RenderRegion<GridRegionMeta>,
  cellData: CellDataSource,
  positionIndex: ViewportPositionIndex,
  mergeIndex: ViewportMergeIndex,
  reader: InteractiveCellReader | undefined,
  editorState: ReturnType<SelectionDataSource['getEditorState']>,
  collector: InteractiveElementCollector,
): void {
  forEachVisibleCell(cellRange, positionIndex, mergeIndex, (cell) => {
    if (
      editorState.isEditing &&
      editorState.editingCell !== null &&
      editorState.editingCell.row === cell.row &&
      editorState.editingCell.col === cell.col
    ) {
      return;
    }

    const coord = { row: cell.row, col: cell.col };
    const filterHeaderInfo = cellData.getFilterHeaderInfo(sheetId, coord);
    const filterInfo = filterHeaderInfo
      ? {
          filterId: filterHeaderInfo.filterId,
          headerCellId: filterHeaderInfo.headerCellId,
          hasActiveFilter: filterHeaderInfo.hasActiveFilter,
        }
      : undefined;

    let hasComment = false;
    let isCheckbox = false;
    let isChecked = false;
    if (reader?.moveTo(cell.row, cell.col)) {
      hasComment = reader.hasComment;
      isCheckbox = reader.isCheckbox;
      isChecked = isReaderCheckboxChecked(reader);
    }

    if (!hasComment && !isCheckbox && !filterInfo) {
      return;
    }

    const local = docToRegionXY(cell.x, cell.y, region);
    const mergeLocal = cell.merge
      ? docToRegionXY(cell.merge.mergeX, cell.merge.mergeY, region)
      : undefined;
    const cellInfo: CellRenderInfo = {
      row: cell.row,
      col: cell.col,
      x: local.x,
      y: local.y,
      width: cell.width,
      height: cell.height,
      value: null,
      format: undefined,
      displayText: '',
      isEditing: false,
      merge: cell.merge
        ? {
            originRow: cell.merge.originRow,
            originCol: cell.merge.originCol,
            mergeWidth: cell.merge.mergeWidth,
            mergeHeight: cell.merge.mergeHeight,
            mergeX: mergeLocal!.x,
            mergeY: mergeLocal!.y,
          }
        : undefined,
    };

    collectInteractiveElements(
      cellInfo,
      {
        hasComment,
        isCheckbox,
        isChecked,
        filterInfo,
        sheetId,
      },
      collector,
    );
  });
}
