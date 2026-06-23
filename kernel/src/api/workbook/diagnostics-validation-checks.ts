import type {
  ValidateWorkbookOptions,
  WorkbookBlankRegionCheckInput,
  WorkbookExternalReferenceCheckOptions,
  WorkbookFormulaShapeCheckInput,
  WorkbookValidationFinding,
  WorkbookValidationResult,
  WorkbookValidationScanOptions,
} from '@mog-sdk/contracts/api';
import { RangeValueType } from '@mog-sdk/contracts/api';

import type { RangeCellData } from '../../bridges/compute/compute-types.gen';
import type { DocumentContext } from '../../context';
import { classifyRangeValueType, normalizeCellValue } from '../internal/value-conversions';
import { toA1 } from '../internal/utils';
import type { WorkbookDiagnosticsDeps } from './diagnostics-deps';
import {
  createWorkbookValidationCellFinding,
  diagnosticCellKey,
  diagnosticRangeCellCount,
  displayWorkbookDiagnosticAddress,
  isWorkbookDiagnosticBlankValue,
  mergeWorkbookValidationResults,
  normalizeWorkbookDiagnosticLimit,
  resolveDiagnosticScanRanges,
  resolveExplicitDiagnosticRanges,
  unsupportedWorkbookValidationResult,
  workbookDiagnosticWorksheetApiCall,
  workbookValidationResult,
} from './diagnostics-validation-helpers';

export async function checkWorkbookFormulaErrorValues(
  ctx: DocumentContext,
  options: WorkbookValidationScanOptions = {},
): Promise<WorkbookValidationResult> {
  const check = 'formula-error-values';
  const limit = normalizeWorkbookDiagnosticLimit(options.limit);
  const resolution = await resolveDiagnosticScanRanges(ctx, options, check);
  if ('result' in resolution) return resolution.result;

  let checkedCells = 0;
  let checkedRanges = 0;
  let truncated = false;
  const findings: WorkbookValidationFinding[] = [];

  for (const range of resolution.ranges) {
    if (truncated) break;
    checkedRanges++;
    const rangeResult = await ctx.computeBridge.queryRange(
      range.sheetId,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
    );
    checkedCells += diagnosticRangeCellCount(range);
    for (const cell of rangeResult.cells) {
      if (!cell.formula) continue;
      const value = normalizeCellValue(cell.value);
      if (classifyRangeValueType(value) !== RangeValueType.Error) continue;
      const address = toA1(cell.row, cell.col);
      findings.push(
        createWorkbookValidationCellFinding(check, 'error', 'FORMULA_ERROR_VALUE', range, cell, {
          message: `Formula at ${displayWorkbookDiagnosticAddress(range, address)} evaluates to ${String(value)}.`,
          suggestedNextApiCall: workbookDiagnosticWorksheetApiCall(
            range.sheetName,
            `getCell(${JSON.stringify(address)})`,
          ),
        }),
      );
      if (findings.length >= limit) {
        truncated = true;
        break;
      }
    }
  }

  return workbookValidationResult(check, findings, {
    checkedCells,
    checkedRanges,
    truncated,
  });
}

export async function checkWorkbookBlankRegions(
  ctx: DocumentContext,
  input: WorkbookBlankRegionCheckInput,
): Promise<WorkbookValidationResult> {
  const check = 'blank-regions';
  const limit = normalizeWorkbookDiagnosticLimit(input.limit);
  const resolution = await resolveExplicitDiagnosticRanges(ctx, input.ranges, check);
  if ('result' in resolution) return resolution.result;

  let checkedCells = 0;
  let checkedRanges = 0;
  let truncated = false;
  const findings: WorkbookValidationFinding[] = [];
  const treatWhitespaceAsBlank = input.treatWhitespaceAsBlank ?? true;

  for (const range of resolution.ranges) {
    if (truncated) break;
    checkedRanges++;
    checkedCells += diagnosticRangeCellCount(range);
    const rangeResult = await ctx.computeBridge.queryRange(
      range.sheetId,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
    );
    const occupied = new Map<string, RangeCellData>();
    for (const cell of rangeResult.cells) {
      occupied.set(diagnosticCellKey(cell.row, cell.col), cell);
    }

    for (let row = range.startRow; row <= range.endRow; row++) {
      if (truncated) break;
      for (let col = range.startCol; col <= range.endCol; col++) {
        const cell = occupied.get(diagnosticCellKey(row, col));
        const value = cell ? normalizeCellValue(cell.value) : null;
        const formula = cell?.formula ?? null;
        if (formula || !isWorkbookDiagnosticBlankValue(value, treatWhitespaceAsBlank)) continue;

        const address = toA1(row, col);
        findings.push({
          id: `${check}:${range.sheetId}:${address}`,
          check,
          severity: 'error',
          code: 'REQUIRED_REGION_BLANK',
          message: `Required region ${range.displayRange} has a blank cell at ${displayWorkbookDiagnosticAddress(range, address)}.`,
          sheetId: range.sheetId,
          sheetName: range.sheetName,
          address,
          range: range.displayRange,
          row,
          col,
          currentValue: value,
          formula,
          suggestedNextApiCall: workbookDiagnosticWorksheetApiCall(
            range.sheetName,
            `setCell(${JSON.stringify(address)}, value)`,
          ),
          details: range.label ? { label: range.label } : undefined,
        });
        if (findings.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
  }

  return workbookValidationResult(check, findings, {
    checkedCells,
    checkedRanges,
    truncated,
  });
}

export async function checkWorkbookFormulaShape(
  ctx: DocumentContext,
  input: WorkbookFormulaShapeCheckInput,
): Promise<WorkbookValidationResult> {
  const check = 'formula-shape';
  const limit = normalizeWorkbookDiagnosticLimit(input.limit);
  const resolution = await resolveExplicitDiagnosticRanges(ctx, input.ranges, check);
  if ('result' in resolution) return resolution.result;

  let checkedCells = 0;
  let checkedRanges = 0;
  let truncated = false;
  const findings: WorkbookValidationFinding[] = [];

  for (const range of resolution.ranges) {
    if (truncated) break;
    checkedRanges++;
    checkedCells += diagnosticRangeCellCount(range);
    const sourceRequest = range.request as WorkbookFormulaShapeCheckInput['ranges'][number];
    const expectedFormula = sourceRequest.expectedFormula;
    const allowBlanks = sourceRequest.allowBlanks ?? false;
    const allowConstants = sourceRequest.allowConstants ?? false;
    const rangeResult = await ctx.computeBridge.queryRange(
      range.sheetId,
      range.startRow,
      range.startCol,
      range.endRow,
      range.endCol,
    );
    const occupied = new Map<string, RangeCellData>();
    for (const cell of rangeResult.cells) {
      occupied.set(diagnosticCellKey(cell.row, cell.col), cell);
    }

    for (let row = range.startRow; row <= range.endRow; row++) {
      if (truncated) break;
      for (let col = range.startCol; col <= range.endCol; col++) {
        const cell = occupied.get(diagnosticCellKey(row, col));
        const value = cell ? normalizeCellValue(cell.value) : null;
        const formula = cell?.formula ?? null;
        const address = toA1(row, col);

        let finding: WorkbookValidationFinding | null = null;
        if (formula) {
          if (expectedFormula && formula !== expectedFormula) {
            finding = createWorkbookValidationCellFinding(
              check,
              'warning',
              'FORMULA_SHAPE_MISMATCH',
              range,
              cell!,
              {
                message: `Formula at ${displayWorkbookDiagnosticAddress(range, address)} does not match the expected formula shape.`,
                expectedFormula,
                suggestedNextApiCall: workbookDiagnosticWorksheetApiCall(
                  range.sheetName,
                  `setFormula(${JSON.stringify(address)}, ${JSON.stringify(expectedFormula)})`,
                ),
              },
            );
          }
        } else if (isWorkbookDiagnosticBlankValue(value, true)) {
          if (!allowBlanks) {
            finding = {
              id: `${check}:${range.sheetId}:${address}`,
              check,
              severity: 'error',
              code: 'FORMULA_RANGE_BLANK',
              message: `Formula-intended range ${range.displayRange} has a blank cell at ${displayWorkbookDiagnosticAddress(range, address)}.`,
              sheetId: range.sheetId,
              sheetName: range.sheetName,
              address,
              range: range.displayRange,
              row,
              col,
              currentValue: value,
              formula,
              expectedFormula,
              suggestedNextApiCall: expectedFormula
                ? workbookDiagnosticWorksheetApiCall(
                    range.sheetName,
                    `setFormula(${JSON.stringify(address)}, ${JSON.stringify(expectedFormula)})`,
                  )
                : workbookDiagnosticWorksheetApiCall(
                    range.sheetName,
                    `setFormula(${JSON.stringify(address)}, '=...')`,
                  ),
              details: range.label ? { label: range.label } : undefined,
            };
          }
        } else if (typeof value === 'string' && value.trim().startsWith('=')) {
          finding = {
            id: `${check}:${range.sheetId}:${address}`,
            check,
            severity: 'error',
            code: 'FORMULA_LIKE_TEXT_VALUE',
            message: `Cell ${displayWorkbookDiagnosticAddress(range, address)} contains formula-like text stored as a value.`,
            sheetId: range.sheetId,
            sheetName: range.sheetName,
            address,
            range: range.displayRange,
            row,
            col,
            currentValue: value,
            formula,
            expectedFormula,
            suggestedNextApiCall: workbookDiagnosticWorksheetApiCall(
              range.sheetName,
              `setFormula(${JSON.stringify(address)}, ${JSON.stringify(value)})`,
            ),
            details: range.label ? { label: range.label } : undefined,
          };
        } else if (!allowConstants) {
          finding = {
            id: `${check}:${range.sheetId}:${address}`,
            check,
            severity: 'error',
            code: 'HARDCODE_IN_FORMULA_RANGE',
            message: `Formula-intended range ${range.displayRange} has a hardcoded value at ${displayWorkbookDiagnosticAddress(range, address)}.`,
            sheetId: range.sheetId,
            sheetName: range.sheetName,
            address,
            range: range.displayRange,
            row,
            col,
            currentValue: value,
            formula,
            expectedFormula,
            suggestedNextApiCall: expectedFormula
              ? workbookDiagnosticWorksheetApiCall(
                  range.sheetName,
                  `setFormula(${JSON.stringify(address)}, ${JSON.stringify(expectedFormula)})`,
                )
              : workbookDiagnosticWorksheetApiCall(
                  range.sheetName,
                  `setFormula(${JSON.stringify(address)}, '=...')`,
                ),
            details: range.label ? { label: range.label } : undefined,
          };
        }

        if (!finding) continue;
        findings.push(finding);
        if (findings.length >= limit) {
          truncated = true;
          break;
        }
      }
    }
  }

  return workbookValidationResult(check, findings, {
    checkedCells,
    checkedRanges,
    truncated,
  });
}

export async function checkWorkbookDirtyState(
  deps: WorkbookDiagnosticsDeps,
): Promise<WorkbookValidationResult> {
  const check = 'dirty-state';
  if (!deps.isDirty) {
    return unsupportedWorkbookValidationResult(
      check,
      'Workbook dirty state is unavailable in this diagnostics context.',
      'Pass the workbook dirty-state accessor into WorkbookDiagnosticsImpl.',
    );
  }
  const isDirty = deps.isDirty();
  const findings: WorkbookValidationFinding[] = isDirty
    ? [
        {
          id: `${check}:workbook`,
          check,
          severity: 'warning',
          code: 'WORKBOOK_DIRTY',
          message: 'Workbook has unsaved changes.',
          suggestedNextApiCall: 'await wb.save()',
        },
      ]
    : [];
  return workbookValidationResult(check, findings, { checkedRanges: 0, checkedCells: 0 });
}

export async function checkWorkbookOpenXmlLoadability(
  deps: WorkbookDiagnosticsDeps,
): Promise<WorkbookValidationResult> {
  if (deps.checkOpenXmlLoadability) {
    return deps.checkOpenXmlLoadability();
  }
  return unsupportedWorkbookValidationResult(
    'openxml-loadability',
    'OpenXML loadability validation requires an XLSX parser callback in this runtime.',
    'Export with wb.toXlsx(), then re-open through the SDK/runtime parser once available.',
  );
}

export async function checkWorkbookStaleCachedValues(
  deps: WorkbookDiagnosticsDeps,
): Promise<WorkbookValidationResult> {
  if (deps.checkStaleCachedValues) {
    return deps.checkStaleCachedValues();
  }
  return unsupportedWorkbookValidationResult(
    'stale-cached-values',
    'Stale cached-value validation requires compute metadata that is not exposed in this runtime.',
    'Run await wb.calculate() before export and inspect the CalculateResult.',
  );
}

export async function validateWorkbookDiagnostics(
  checks: {
    readonly checkFormulaErrorValues: (
      options?: WorkbookValidationScanOptions,
    ) => Promise<WorkbookValidationResult>;
    readonly checkExternalReferences: (
      options?: WorkbookExternalReferenceCheckOptions,
    ) => Promise<WorkbookValidationResult>;
    readonly checkBlankRegions: (
      input: WorkbookBlankRegionCheckInput,
    ) => Promise<WorkbookValidationResult>;
    readonly checkFormulaShape: (
      input: WorkbookFormulaShapeCheckInput,
    ) => Promise<WorkbookValidationResult>;
    readonly checkWorkbookDirtyState: () => Promise<WorkbookValidationResult>;
    readonly checkOpenXmlLoadability: () => Promise<WorkbookValidationResult>;
    readonly checkStaleCachedValues: () => Promise<WorkbookValidationResult>;
  },
  options: ValidateWorkbookOptions = {},
): Promise<WorkbookValidationResult> {
  const results: WorkbookValidationResult[] = [];
  if (options.includeFormulaErrorValues ?? true) {
    results.push(await checks.checkFormulaErrorValues(options.formulaErrorValues));
  }
  if (options.includeExternalReferences ?? true) {
    results.push(await checks.checkExternalReferences(options.externalReferences));
  }
  if (options.blankRegions) {
    results.push(await checks.checkBlankRegions(options.blankRegions));
  }
  if (options.formulaShape) {
    results.push(await checks.checkFormulaShape(options.formulaShape));
  }
  if (options.includeDirtyState ?? true) {
    results.push(await checks.checkWorkbookDirtyState());
  }
  if (options.includeOpenXml ?? false) {
    results.push(await checks.checkOpenXmlLoadability());
  }
  if (options.includeStaleValues ?? false) {
    results.push(await checks.checkStaleCachedValues());
  }
  return mergeWorkbookValidationResults(results);
}
