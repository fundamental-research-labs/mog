import type {
  WorkbookValidationCheckKind,
  WorkbookValidationCheckResult,
  WorkbookValidationFinding,
  WorkbookValidationRangeRequest,
  WorkbookValidationResult,
  WorkbookValidationScanOptions,
} from '@mog-sdk/contracts/api';
import type { CellValuePrimitive, SheetId } from '@mog-sdk/contracts/core';

import type { RangeCellData } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import { normalizeCellValue } from '../internal/value-conversions';
import { normalizeRange, parseCellRange, rangeToA1, toA1 } from '../internal/utils';

const DEFAULT_FINDING_LIMIT = 1000;

export interface ResolvedDiagnosticSheet {
  readonly sheetId: SheetId;
  readonly sheetName?: string;
}

export interface ResolvedDiagnosticValidationRange extends ResolvedDiagnosticSheet {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  readonly displayRange: string;
  readonly label?: string;
  readonly request: WorkbookValidationRangeRequest;
}

export function displayWorkbookDiagnosticAddress(
  range: Pick<ResolvedDiagnosticValidationRange, 'sheetName'>,
  address: string,
): string {
  return range.sheetName ? `${range.sheetName}!${address}` : address;
}

export function workbookDiagnosticWorksheetApiCall(
  sheetName: string | undefined,
  worksheetExpression: string,
): string | undefined {
  if (!sheetName) return undefined;
  return `await wb.getSheet(${JSON.stringify(sheetName)}).then(ws => ws.${worksheetExpression})`;
}

export function normalizeWorkbookDiagnosticLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit == null || limit <= 0) return DEFAULT_FINDING_LIMIT;
  return Math.floor(limit);
}

export function workbookValidationResult(
  check: WorkbookValidationCheckKind,
  findings: WorkbookValidationFinding[],
  summary: Partial<WorkbookValidationCheckResult> = {},
): WorkbookValidationResult {
  const truncated = summary.truncated ?? false;
  const status = findings.length > 0 ? 'failed' : 'passed';
  return {
    ok: status === 'passed',
    checks: [
      {
        check,
        status,
        findingsCount: findings.length,
        checkedCells: summary.checkedCells,
        checkedRanges: summary.checkedRanges,
        truncated,
        message: summary.message,
      },
    ],
    findings,
    truncated,
  };
}

export function unsupportedWorkbookValidationResult(
  check: WorkbookValidationCheckKind,
  message: string,
  suggestedNextApiCall: string,
): WorkbookValidationResult {
  const finding: WorkbookValidationFinding = {
    id: `${check}:unsupported`,
    check,
    severity: 'warning',
    code: 'VALIDATION_CHECK_UNSUPPORTED',
    message,
    suggestedNextApiCall,
  };
  return {
    ok: false,
    checks: [
      {
        check,
        status: 'unsupported',
        findingsCount: 1,
        message,
      },
    ],
    findings: [finding],
    truncated: false,
  };
}

export function invalidWorkbookValidationConfigFinding(
  check: WorkbookValidationCheckKind,
  message: string,
): WorkbookValidationFinding {
  return {
    id: `${check}:invalid-config`,
    check,
    severity: 'error',
    code: 'VALIDATION_CONFIG_INVALID',
    message,
  };
}

export function mergeWorkbookValidationResults(
  results: readonly WorkbookValidationResult[],
): WorkbookValidationResult {
  const checks = results.flatMap((result) => result.checks);
  const findings = results.flatMap((result) => result.findings);
  return {
    ok: results.every((result) => result.ok),
    checks,
    findings,
    truncated: results.some((result) => result.truncated),
  };
}

export async function resolveDiagnosticScanRanges(
  ctx: DocumentContext,
  options: WorkbookValidationScanOptions,
  check: WorkbookValidationCheckKind,
): Promise<{ ranges: ResolvedDiagnosticValidationRange[] } | { result: WorkbookValidationResult }> {
  if (options.ranges?.length) {
    return resolveExplicitDiagnosticRanges(ctx, options.ranges, check);
  }
  if (options.range) {
    return resolveExplicitDiagnosticRanges(
      ctx,
      [
        {
          sheetId: options.sheetId,
          sheetName: options.sheetName,
          range: options.range,
        },
      ],
      check,
    );
  }
  if (options.sheetId || options.sheetName) {
    const sheet = await resolveDiagnosticSheet(ctx, options.sheetId, options.sheetName);
    if (!sheet) {
      return {
        result: workbookValidationResult(check, [
          invalidWorkbookValidationConfigFinding(
            check,
            `Sheet ${options.sheetId ?? options.sheetName ?? ''} could not be resolved.`,
          ),
        ]),
      };
    }
    const bounds = await ctx.computeBridge.getDataBounds(sheet.sheetId);
    if (!bounds) return { ranges: [] };
    return {
      ranges: [
        {
          ...sheet,
          ...boundsToDiagnosticRange(bounds),
          displayRange: rangeToA1(
            { sheetId: sheet.sheetId, ...boundsToDiagnosticRange(bounds) },
            false,
          ),
          request: { sheetId: sheet.sheetId, range: '' },
        },
      ],
    };
  }

  const sheets = await listDiagnosticSheets(ctx);
  const ranges: ResolvedDiagnosticValidationRange[] = [];
  for (const sheet of sheets) {
    const bounds = await ctx.computeBridge.getDataBounds(sheet.sheetId);
    if (!bounds) continue;
    ranges.push({
      ...sheet,
      ...boundsToDiagnosticRange(bounds),
      displayRange: rangeToA1(
        { sheetId: sheet.sheetId, ...boundsToDiagnosticRange(bounds) },
        false,
      ),
      request: { sheetId: sheet.sheetId, range: '' },
    });
  }
  return { ranges };
}

export async function resolveExplicitDiagnosticRanges(
  ctx: DocumentContext,
  requests: readonly WorkbookValidationRangeRequest[],
  check: WorkbookValidationCheckKind,
): Promise<{ ranges: ResolvedDiagnosticValidationRange[] } | { result: WorkbookValidationResult }> {
  const ranges: ResolvedDiagnosticValidationRange[] = [];
  const findings: WorkbookValidationFinding[] = [];

  for (const request of requests) {
    const parsed = parseCellRange(request.range);
    if (!parsed) {
      findings.push(
        invalidWorkbookValidationConfigFinding(check, `Invalid range: ${request.range}`),
      );
      continue;
    }
    const sheet = await resolveDiagnosticSheet(
      ctx,
      request.sheetId,
      request.sheetName ?? parsed.sheetName,
    );
    if (!sheet) {
      findings.push(
        invalidWorkbookValidationConfigFinding(
          check,
          `Range ${request.range} must identify a sheet when the workbook has more than one sheet.`,
        ),
      );
      continue;
    }
    const normalized = normalizeRange({
      sheetId: sheet.sheetId,
      startRow: parsed.startRow,
      startCol: parsed.startCol,
      endRow: parsed.endRow,
      endCol: parsed.endCol,
    });
    ranges.push({
      sheetId: sheet.sheetId,
      sheetName: sheet.sheetName,
      startRow: normalized.startRow,
      startCol: normalized.startCol,
      endRow: normalized.endRow,
      endCol: normalized.endCol,
      displayRange: rangeToA1(normalized, false),
      label: request.label,
      request,
    });
  }

  if (findings.length) {
    return { result: workbookValidationResult(check, findings, { checkedRanges: ranges.length }) };
  }
  return { ranges };
}

export async function resolveDiagnosticSheet(
  ctx: DocumentContext,
  sheetId?: SheetId,
  sheetName?: string,
): Promise<ResolvedDiagnosticSheet | null> {
  if (sheetId) {
    const name = await ctx.computeBridge.getSheetName(sheetId);
    return { sheetId, sheetName: name ?? undefined };
  }

  const sheets = await listDiagnosticSheets(ctx);
  if (sheetName) {
    const lower = sheetName.toLowerCase();
    return sheets.find((sheet) => sheet.sheetName?.toLowerCase() === lower) ?? null;
  }
  return sheets.length === 1 ? sheets[0] : null;
}

export async function listDiagnosticSheets(
  ctx: DocumentContext,
): Promise<ResolvedDiagnosticSheet[]> {
  const ids = await ctx.computeBridge.getAllSheetIds();
  return Promise.all(
    ids.map(async (id) => ({
      sheetId: id,
      sheetName: (await ctx.computeBridge.getSheetName(id)) ?? undefined,
    })),
  );
}

export function createWorkbookValidationCellFinding(
  check: WorkbookValidationCheckKind,
  severity: WorkbookValidationFinding['severity'],
  code: string,
  range: ResolvedDiagnosticValidationRange,
  cell: RangeCellData,
  input: {
    message: string;
    expectedFormula?: string;
    suggestedNextApiCall?: string;
  },
): WorkbookValidationFinding {
  const value = normalizeCellValue(cell.value);
  const address = toA1(cell.row, cell.col);
  return {
    id: `${check}:${range.sheetId}:${address}`,
    check,
    severity,
    code,
    message: input.message,
    sheetId: range.sheetId,
    sheetName: range.sheetName,
    address,
    range: range.displayRange,
    row: cell.row,
    col: cell.col,
    currentValue: value,
    formula: cell.formula ?? null,
    expectedFormula: input.expectedFormula,
    suggestedNextApiCall: input.suggestedNextApiCall,
    details: range.label ? { label: range.label } : undefined,
  };
}

export function diagnosticRangeCellCount(
  range: Pick<ResolvedDiagnosticValidationRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>,
): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

export function diagnosticCellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

export function isWorkbookDiagnosticBlankValue(
  value: CellValuePrimitive | null,
  treatWhitespaceAsBlank: boolean,
): boolean {
  return (
    value == null ||
    value === '' ||
    (treatWhitespaceAsBlank && typeof value === 'string' && value.trim() === '')
  );
}

function boundsToDiagnosticRange(bounds: {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}): Pick<ResolvedDiagnosticValidationRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'> {
  return {
    startRow: bounds.minRow,
    startCol: bounds.minCol,
    endRow: bounds.maxRow,
    endCol: bounds.maxCol,
  };
}
