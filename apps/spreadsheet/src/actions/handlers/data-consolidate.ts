import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { CellRange } from '@mog-sdk/contracts/core';
import { parseCellRange, toA1 } from '@mog/spreadsheet-utils/a1';
import { normalizeRange } from '@mog/spreadsheet-utils/range';

import { buildConsolidateOutput, type ConsolidateSourceRange } from '../../domain/data/consolidate';
import { guardBridgeMutation } from './bridge-error-guard';
import { getUIStore } from './handler-utils';

export const OPEN_CONSOLIDATE_DIALOG: ActionHandler = (deps): ActionResult => {
  const activeCell = deps.accessors?.selection?.getActiveCell?.() ?? null;
  const destination = activeCell ? toA1(activeCell.row, activeCell.col) : undefined;
  getUIStore(deps)
    .getState()
    .openConsolidateDialog(destination ? { destination } : undefined);
  return { handled: true };
};

export const CLOSE_CONSOLIDATE_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeConsolidateDialog();
  return { handled: true };
};

export const EXECUTE_CONSOLIDATE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const store = getUIStore(deps);
  const state = store.getState();
  const dialog = state.consolidateDialog;
  const activeSheetId = deps.getActiveSheetId();
  const activeSheet = deps.workbook.getSheetById(activeSheetId);

  const destinationRange = parseDialogRange(dialog.destination, 'Destination');
  if ('error' in destinationRange) return destinationRange.error;
  const destinationSheet = destinationRange.sheetName
    ? await deps.workbook.getSheet(destinationRange.sheetName)
    : activeSheet;
  const destinationSheetId = destinationSheet.getSheetId();

  const sources: ConsolidateSourceRange[] = [];
  for (const sourceRef of dialog.sourceReferences) {
    const parsed = parseDialogRange(sourceRef.reference, 'Reference');
    if ('error' in parsed) return parsed.error;
    const sourceSheet = parsed.sheetName
      ? await deps.workbook.getSheet(parsed.sheetName)
      : activeSheet;
    const sourceSheetId = sourceSheet.getSheetId();
    const sourceSheetName =
      parsed.sheetName ??
      (sourceSheetId !== destinationSheetId ? await sourceSheet.getName() : undefined);
    const cells = await sourceSheet.getRange(parsed.range);
    sources.push({
      reference: sourceRef.reference,
      range: parsed.range,
      cells,
      sheetName: sourceSheetName,
      qualifyFormulas: Boolean(sourceSheetName && sourceSheetId !== destinationSheetId),
    });
  }

  if (sources.length === 0) {
    return { handled: true, error: 'Consolidate requires at least one source reference.' };
  }

  const output = buildConsolidateOutput({
    func: dialog.func,
    sources,
    useTopRowLabels: dialog.useTopRowLabels,
    useLeftColumnLabels: dialog.useLeftColumnLabels,
    createLinks: dialog.createLinks,
  });

  if (output.values.length === 0 || output.values[0]?.length === 0) {
    return { handled: true, error: 'Consolidate source ranges contain no data cells.' };
  }

  const ok = await guardBridgeMutation(() =>
    destinationSheet.setRange(
      destinationRange.range.startRow,
      destinationRange.range.startCol,
      output.values,
    ),
  );
  if (!ok) return { handled: true };

  state.closeConsolidateDialog();
  return { handled: true };
};

function parseDialogRange(
  reference: string,
  label: string,
): { range: CellRange; sheetName?: string } | { error: ActionResult } {
  const trimmed = reference.trim();
  const parsed = parseCellRange(trimmed);
  if (!parsed) {
    return { error: { handled: true, error: `${label} must be a valid A1 reference.` } };
  }
  if (parsed.isFullColumn || parsed.isFullRow) {
    return {
      error: {
        handled: true,
        error: `${label} must be a bounded cell range, not a full row or column.`,
      },
    };
  }
  return {
    range: normalizeRange(parsed),
    ...(parsed.sheetName ? { sheetName: parsed.sheetName } : {}),
  };
}
