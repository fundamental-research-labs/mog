import type {
  WorkbookValidationCheckKind,
  WorkbookValidationFinding,
} from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../context';
import {
  buildUnboundExternalFormulaFeedback,
  findExternalFormulaLink,
  getExternalFormulaReferences,
  getTrackedExternalFormulas,
  type ExternalFormulaCell,
  type ParsedExternalRef,
} from '../../services/external-formulas';
import { toA1 } from '../internal/utils';

interface ResolvedSheet {
  readonly sheetId: SheetId;
  readonly sheetName: string;
}

export async function diagnoseTrackedExternalFormulaReferences(
  ctx: DocumentContext,
  check: WorkbookValidationCheckKind,
  limit: number,
): Promise<{ findings: WorkbookValidationFinding[]; truncated: boolean }> {
  const trackedFormulas = getTrackedExternalFormulas(ctx);
  if (limit <= 0 || trackedFormulas.length === 0) {
    return { findings: [], truncated: false };
  }

  const sheets = await listSheets(ctx);
  const sheetNamesById = new Map(sheets.map((sheet) => [sheet.sheetId, sheet.sheetName]));
  const localSheetNames = new Map(
    sheets.map((sheet) => [sheet.sheetName.toLowerCase(), sheet.sheetName]),
  );
  const linkRecords = ctx.workbookLinks.listRecords();
  const findings: WorkbookValidationFinding[] = [];
  let truncated = false;

  for (const cell of trackedFormulas) {
    const sourceSheetName =
      sheetNamesById.get(cell.sheetId) ??
      (await ctx.computeBridge.getSheetName(cell.sheetId)) ??
      cell.sheetId;
    const address = toA1(cell.row, cell.col);

    for (const ref of getExternalFormulaReferences(cell.formula)) {
      if (findExternalFormulaLink(linkRecords, ref.workbookToken)) continue;

      const localSheetName = localSheetNames.get(ref.sheetName.toLowerCase());
      const finding = localSheetName
        ? localSheetCandidateFinding(check, cell, sourceSheetName, address, ref, localSheetName)
        : unboundExternalFormulaFinding(check, cell, sourceSheetName, address, ref);
      findings.push(finding);

      if (findings.length >= limit) {
        truncated = true;
        break;
      }
    }

    if (truncated) break;
  }

  return { findings, truncated };
}

function localSheetCandidateFinding(
  check: WorkbookValidationCheckKind,
  cell: ExternalFormulaCell,
  sourceSheetName: string,
  address: string,
  ref: ParsedExternalRef,
  localSheetName: string,
): WorkbookValidationFinding {
  const feedback = buildUnboundExternalFormulaFeedback(cell.formula, ref, localSheetName);
  return {
    id: `${check}:tracked:${cell.sheetId}:${cell.row}:${cell.col}:${ref.start}:${ref.end}`,
    check,
    severity: 'error',
    code: feedback.code,
    message: feedback.message,
    sheetId: cell.sheetId,
    sheetName: sourceSheetName,
    address,
    row: cell.row,
    col: cell.col,
    formula: cell.formula,
    suggestedNextApiCall: `await wb.getSheet(${JSON.stringify(sourceSheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, ${JSON.stringify(feedback.suggestedFormula)}))`,
    details: feedback.details,
  };
}

function unboundExternalFormulaFinding(
  check: WorkbookValidationCheckKind,
  cell: ExternalFormulaCell,
  sourceSheetName: string,
  address: string,
  ref: ParsedExternalRef,
): WorkbookValidationFinding {
  const feedback = buildUnboundExternalFormulaFeedback(cell.formula, ref);
  return {
    id: `${check}:tracked:${cell.sheetId}:${cell.row}:${cell.col}:${ref.start}:${ref.end}`,
    check,
    severity: 'error',
    code: feedback.code,
    message: feedback.message,
    sheetId: cell.sheetId,
    sheetName: sourceSheetName,
    address,
    row: cell.row,
    col: cell.col,
    formula: cell.formula,
    suggestedNextApiCall:
      "await wb.links.create({ displayName: 'Budget.xlsx', sourceKind: 'excel-workbook', target: { kind: 'path', path: '...' } })",
    details: feedback.details,
  };
}

async function listSheets(ctx: DocumentContext): Promise<ResolvedSheet[]> {
  const ids = await ctx.computeBridge.getAllSheetIds();
  return Promise.all(
    ids.map(async (id) => ({
      sheetId: id,
      sheetName: (await ctx.computeBridge.getSheetName(id)) ?? id,
    })),
  );
}
