import { displayString, type SheetId } from '@mog-sdk/contracts/core';
import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { CellRange } from '@mog-sdk/contracts/core';
import type { CellCoord } from '@mog-sdk/contracts/rendering';
import type { MutationResult } from '@mog-sdk/contracts/protection';
import { detectFormatType } from '@mog/spreadsheet-utils/number-formats';
import { protectionError, successResult } from '@mog/spreadsheet-utils/protection';

import type { ClipboardActor } from './machines/clipboard-machine';
import type { EditorActor } from './machines/grid-editor-machine';
import type { SelectionActor } from './machines/grid-selection-machine';
import type { EditorEntryMode } from './machines/editor/types';
import { resolveAndApplyValidationEditorConfig } from './coordination/editor-validation-resolution';

export interface BeginEditSessionRequest {
  sheetId: SheetId;
  cell: CellCoord;
  entryMode: EditorEntryMode;
  initialTextHint?: string;
  cursorPositionHint?: number;
  mergedRegion?: CellRange;
  formulaInputIsLiteral?: boolean;
  openDropdown?: boolean;
}

export interface EditEntryServiceOptions {
  workbook?: WorkbookInternal;
  clipboardActor: ClipboardActor;
  selectionActor: SelectionActor;
  editorActor: EditorActor;
  isReadOnly: () => boolean;
  getMergedRegion?: (sheetId: SheetId, cell: CellCoord) => CellRange | undefined;
  getPreEditSelectionRanges?: () => CellRange[];
}

export interface EditEntryService {
  beginEditSession(request: BeginEditSessionRequest): Promise<MutationResult>;
  invalidate(reason: string): void;
}

function isCellInCutRange(
  clipboardActor: ClipboardActor,
  sheetId: SheetId,
  cell: CellCoord,
): boolean {
  const snapshot = clipboardActor.getSnapshot();
  if (!snapshot.matches('hasCut')) return false;

  const context = snapshot.context as {
    data?: { sourceSheetId?: string } | null;
    sourceRanges?: CellRange[] | null;
  };
  if (!context.data || context.data.sourceSheetId !== sheetId) return false;

  const sourceRanges = context.sourceRanges;
  if (!sourceRanges) return false;

  return sourceRanges.some(
    (range) =>
      cell.row >= range.startRow &&
      cell.row <= range.endRow &&
      cell.col >= range.startCol &&
      cell.col <= range.endCol,
  );
}

export function createEditEntryService(options: EditEntryServiceOptions): EditEntryService {
  let generation = 0;

  const isCurrent = (requestGeneration: number) => requestGeneration === generation;

  const resolveSourceText = (
    request: BeginEditSessionRequest,
    requestGeneration: number,
  ): string | Promise<string | null> => {
    if (request.initialTextHint !== undefined) return request.initialTextHint;

    const wb = options.workbook;
    if (!wb) return '';

    const ws = wb.getSheetById(request.sheetId);
    const activeEditSource = ws.getActiveCellEditSource?.(request.cell.row, request.cell.col);
    if (activeEditSource?.source !== undefined) return activeEditSource.source;

    const viewportCell = ws.viewport.getCellData(request.cell.row, request.cell.col);
    if (viewportCell?.editText !== undefined) return viewportCell.editText;
    if (!viewportCell?.hasFormula) {
      return viewportCell?.displayText ? displayString(viewportCell.displayText) : '';
    }

    return ws
      .getValueForEditing(request.cell.row, request.cell.col)
      .then((source) => (isCurrent(requestGeneration) ? source : null));
  };

  return {
    async beginEditSession(request) {
      const requestGeneration = ++generation;

      if (options.isReadOnly()) {
        return protectionError('Document is in read-only mode');
      }

      if (isCellInCutRange(options.clipboardActor, request.sheetId, request.cell)) {
        return protectionError('Cannot edit cells in cut range');
      }

      const wb = options.workbook;
      if (!wb) {
        return protectionError('Workbook is not available for editing');
      }

      const preEditSelectionRanges = options.getPreEditSelectionRanges?.();
      const ws = wb.getSheetById(request.sheetId);
      const fastEditability = ws.protection.canEditCellFast(request.cell.row, request.cell.col);
      if (fastEditability === 'unknown') {
        const editable = await ws.protection.canEditCell(request.cell.row, request.cell.col);
        if (!isCurrent(requestGeneration)) return protectionError('Edit session was superseded');
        if (!editable) return protectionError('Cannot edit locked cell on protected sheet');
      }

      const sourceTextOrPromise = resolveSourceText(request, requestGeneration);
      const sourceText =
        typeof sourceTextOrPromise === 'string' ? sourceTextOrPromise : await sourceTextOrPromise;
      if (sourceText === null || !isCurrent(requestGeneration)) {
        return protectionError('Edit session was superseded');
      }

      const mergedRegion =
        request.mergedRegion ?? options.getMergedRegion?.(request.sheetId, request.cell);
      let formulaInputIsLiteral = request.formulaInputIsLiteral ?? false;
      if (request.formulaInputIsLiteral === undefined && ws.formats?.get) {
        try {
          const format = await ws.formats.get(request.cell.row, request.cell.col);
          formulaInputIsLiteral = detectFormatType(format.numberFormat ?? 'General') === 'text';
        } catch {
          formulaInputIsLiteral = false;
        }
      }

      options.selectionActor.send({
        type: 'BEGIN_CELL_EDIT',
        cell: request.cell,
      });
      options.editorActor.send({
        type: 'START_EDITING',
        cell: request.cell,
        sheetId: request.sheetId,
        initialValue: sourceText,
        mergedRegion,
        entryMode: request.entryMode,
        cursorPosition: request.cursorPositionHint,
        formulaInputIsLiteral,
        openDropdown: request.openDropdown,
        preEditSelectionRanges,
      });

      const validationRequest = {
        sheetId: request.sheetId,
        cell: request.cell,
        generation: requestGeneration,
        openDropdown: request.openDropdown,
        isCurrent,
        editorActor: options.editorActor,
      };
      void resolveAndApplyValidationEditorConfig(ws, validationRequest);

      return successResult();
    },

    invalidate() {
      generation++;
    },
  };
}
