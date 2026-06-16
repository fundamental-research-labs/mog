import type {
  FormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  ImportDiagnosticDto,
  ResolvedChartSpecDiagnosticsOptions,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  RuntimeOperationDiagnostic,
  CheckErrorsOptions,
  ValidateWorkbookOptions,
  WorkbookBlankRegionCheckInput,
  WorkbookDiagnostics,
  WorkbookExternalReferenceCheckOptions,
  WorkbookFormulaShapeCheckInput,
  WorkbookValidationCheckKind,
  WorkbookValidationCheckResult,
  WorkbookValidationFinding,
  WorkbookValidationRangeRequest,
  WorkbookValidationResult,
  WorkbookValidationScanOptions,
} from '@mog-sdk/contracts/api';
import { RangeValueType } from '@mog-sdk/contracts/api';
import { normalizeImageExportOptions } from '@mog/charts/export';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { CellValuePrimitive, SheetId } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { DocumentContext } from '../../context';
import type {
  FormulaReferenceDiagnostic as BridgeFormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions as BridgeFormulaReferenceDiagnosticsOptions,
  ExternalLinkStatusSnapshot,
  RangeCellData,
  RuntimeOperationDiagnostic as BridgeRuntimeOperationDiagnostic,
} from '../../bridges/compute/compute-types.gen';
import { chartNotFound, operationFailed } from '../../errors/api';
import type { MaterializationState } from '@mog-sdk/contracts/api';
import { classifyRangeValueType, normalizeCellValue } from '../internal/value-conversions';
import { normalizeRange, parseCellRange, rangeToA1, toA1 } from '../internal/utils';
import { projectImportDiagnostic } from '../document/import-diagnostics';

const DEFAULT_FINDING_LIMIT = 1000;
const ERROR_REFERENCE_KINDS = new Set([
  'unresolved-external-reference',
  'external-reference-warning',
]);
const BAD_LINK_STATUSES = new Set(['unresolved', 'stale', 'denied', 'broken', 'ambiguous']);

export interface WorkbookDiagnosticsDeps {
  readonly isDirty?: () => boolean;
  readonly checkOpenXmlLoadability?: () => Promise<WorkbookValidationResult>;
  readonly checkStaleCachedValues?: () => Promise<WorkbookValidationResult>;
}

export class WorkbookDiagnosticsImpl implements WorkbookDiagnostics {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly deps: WorkbookDiagnosticsDeps = {},
  ) {}

  async checkErrors(options: CheckErrorsOptions = {}): Promise<WorkbookValidationResult> {
    return this.validateWorkbook({
      includeFormulaErrorValues: true,
      includeExternalReferences: true,
      includeDirtyState: true,
      includeOpenXml: true,
      includeStaleValues: true,
      ...options,
    });
  }

  async checkFormulaErrors(
    options: WorkbookValidationScanOptions = {},
  ): Promise<WorkbookValidationResult> {
    return this.checkFormulaErrorValues(options);
  }

  async checkFormulaErrorValues(
    options: WorkbookValidationScanOptions = {},
  ): Promise<WorkbookValidationResult> {
    const check = 'formula-error-values';
    const limit = normalizeLimit(options.limit);
    const resolution = await this.resolveScanRanges(options, check);
    if ('result' in resolution) return resolution.result;

    let checkedCells = 0;
    let checkedRanges = 0;
    let truncated = false;
    const findings: WorkbookValidationFinding[] = [];

    for (const range of resolution.ranges) {
      if (truncated) break;
      checkedRanges++;
      const rangeResult = await this.ctx.computeBridge.queryRange(
        range.sheetId,
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
      );
      checkedCells += rangeCellCount(range);
      for (const cell of rangeResult.cells) {
        if (!cell.formula) continue;
        const value = normalizeCellValue(cell.value);
        if (classifyRangeValueType(value) !== RangeValueType.Error) continue;
        findings.push(
          this.cellFinding(check, 'error', 'FORMULA_ERROR_VALUE', range, cell, {
            message: `Formula at ${range.sheetName}!${toA1(cell.row, cell.col)} evaluates to ${String(value)}.`,
            suggestedNextApiCall: `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.getCell(${JSON.stringify(toA1(cell.row, cell.col))}))`,
          }),
        );
        if (findings.length >= limit) {
          truncated = true;
          break;
        }
      }
    }

    return validationResult(check, findings, {
      checkedCells,
      checkedRanges,
      truncated,
    });
  }

  async checkExternalReferences(
    options: WorkbookExternalReferenceCheckOptions = {},
  ): Promise<WorkbookValidationResult> {
    const check = 'external-references';
    const limit = normalizeLimit(options.limit);
    const findings: WorkbookValidationFinding[] = [];
    let truncated = false;

    const page = await this.getFormulaReferences({
      includeWarnings: options.includeWarnings ?? true,
      limit,
    });
    for (const diagnostic of page.diagnostics) {
      if (diagnostic.type !== 'reference-edge' || !ERROR_REFERENCE_KINDS.has(diagnostic.kind)) {
        continue;
      }
      findings.push({
        id: `${check}:formula:${diagnostic.id}`,
        check,
        severity: diagnostic.severity,
        code: diagnostic.kind,
        message:
          diagnostic.edge.reason ||
          `External reference ${diagnostic.edge.text} is ${diagnostic.edge.status}.`,
        sheetId: diagnostic.location.sheetId,
        address: diagnostic.location.address,
        row: diagnostic.location.row,
        col: diagnostic.location.col,
        formula: diagnostic.formula ?? null,
        suggestedNextApiCall:
          'await wb.diagnostics.getFormulaReferences({ includeWarnings: true })',
        details: {
          edgeId: diagnostic.edge.edgeId,
          text: diagnostic.edge.text,
          status: diagnostic.edge.status,
          linkId: diagnostic.edge.linkId,
          targetDisplay: diagnostic.edge.targetDisplay,
        },
      });
      if (findings.length >= limit) {
        truncated = true;
        break;
      }
    }

    if (!truncated && this.ctx.workbookLinks) {
      const scope = this.ctx.workbookLinkScope();
      for (const link of this.ctx.workbookLinks.list()) {
        const status = this.ctx.workbookLinks.getStatus(link.linkId, scope);
        if (!BAD_LINK_STATUSES.has(status.status)) continue;
        findings.push({
          id: `${check}:link:${link.linkId}`,
          check,
          severity: status.status === 'stale' ? 'warning' : 'error',
          code: `EXTERNAL_LINK_${status.status.toUpperCase()}`,
          message: `External link "${link.displayName || link.linkId}" is ${status.status}.`,
          suggestedNextApiCall: `await wb.links.getStatus(${JSON.stringify(link.linkId)})`,
          details: {
            linkId: link.linkId,
            sourceKind: link.sourceKind,
            status: status.status,
            statusReason: status.statusReason,
            canRefresh: status.canRefresh,
          },
        });
        if (findings.length >= limit) {
          truncated = true;
          break;
        }
      }
    }

    return validationResult(check, findings, {
      checkedRanges: 0,
      truncated: truncated || Boolean(page.nextCursor),
    });
  }

  async checkBlankRegions(input: WorkbookBlankRegionCheckInput): Promise<WorkbookValidationResult> {
    const check = 'blank-regions';
    const limit = normalizeLimit(input.limit);
    const resolution = await this.resolveExplicitRanges(input.ranges, check);
    if ('result' in resolution) return resolution.result;

    let checkedCells = 0;
    let checkedRanges = 0;
    let truncated = false;
    const findings: WorkbookValidationFinding[] = [];
    const treatWhitespaceAsBlank = input.treatWhitespaceAsBlank ?? true;

    for (const range of resolution.ranges) {
      if (truncated) break;
      checkedRanges++;
      checkedCells += rangeCellCount(range);
      const rangeResult = await this.ctx.computeBridge.queryRange(
        range.sheetId,
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
      );
      const occupied = new Map<string, RangeCellData>();
      for (const cell of rangeResult.cells) {
        occupied.set(cellKey(cell.row, cell.col), cell);
      }

      for (let row = range.startRow; row <= range.endRow; row++) {
        if (truncated) break;
        for (let col = range.startCol; col <= range.endCol; col++) {
          const cell = occupied.get(cellKey(row, col));
          const value = cell ? normalizeCellValue(cell.value) : null;
          const formula = cell?.formula ?? null;
          if (formula || !isBlankValue(value, treatWhitespaceAsBlank)) continue;

          const address = toA1(row, col);
          findings.push({
            id: `${check}:${range.sheetId}:${address}`,
            check,
            severity: 'error',
            code: 'REQUIRED_REGION_BLANK',
            message: `Required region ${range.displayRange} has a blank cell at ${range.sheetName}!${address}.`,
            sheetId: range.sheetId,
            sheetName: range.sheetName,
            address,
            range: range.displayRange,
            row,
            col,
            currentValue: value,
            formula,
            suggestedNextApiCall: `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setCell(${JSON.stringify(address)}, value))`,
            details: range.label ? { label: range.label } : undefined,
          });
          if (findings.length >= limit) {
            truncated = true;
            break;
          }
        }
      }
    }

    return validationResult(check, findings, {
      checkedCells,
      checkedRanges,
      truncated,
    });
  }

  async checkFormulaShape(
    input: WorkbookFormulaShapeCheckInput,
  ): Promise<WorkbookValidationResult> {
    const check = 'formula-shape';
    const limit = normalizeLimit(input.limit);
    const resolution = await this.resolveExplicitRanges(input.ranges, check);
    if ('result' in resolution) return resolution.result;

    let checkedCells = 0;
    let checkedRanges = 0;
    let truncated = false;
    const findings: WorkbookValidationFinding[] = [];

    for (const range of resolution.ranges) {
      if (truncated) break;
      checkedRanges++;
      checkedCells += rangeCellCount(range);
      const sourceRequest = range.request as WorkbookFormulaShapeCheckInput['ranges'][number];
      const expectedFormula = sourceRequest.expectedFormula;
      const allowBlanks = sourceRequest.allowBlanks ?? false;
      const allowConstants = sourceRequest.allowConstants ?? false;
      const rangeResult = await this.ctx.computeBridge.queryRange(
        range.sheetId,
        range.startRow,
        range.startCol,
        range.endRow,
        range.endCol,
      );
      const occupied = new Map<string, RangeCellData>();
      for (const cell of rangeResult.cells) {
        occupied.set(cellKey(cell.row, cell.col), cell);
      }

      for (let row = range.startRow; row <= range.endRow; row++) {
        if (truncated) break;
        for (let col = range.startCol; col <= range.endCol; col++) {
          const cell = occupied.get(cellKey(row, col));
          const value = cell ? normalizeCellValue(cell.value) : null;
          const formula = cell?.formula ?? null;
          const address = toA1(row, col);

          let finding: WorkbookValidationFinding | null = null;
          if (formula) {
            if (expectedFormula && formula !== expectedFormula) {
              finding = this.cellFinding(check, 'warning', 'FORMULA_SHAPE_MISMATCH', range, cell!, {
                message: `Formula at ${range.sheetName}!${address} does not match the expected formula shape.`,
                expectedFormula,
                suggestedNextApiCall: `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, ${JSON.stringify(expectedFormula)}))`,
              });
            }
          } else if (isBlankValue(value, true)) {
            if (!allowBlanks) {
              finding = {
                id: `${check}:${range.sheetId}:${address}`,
                check,
                severity: 'error',
                code: 'FORMULA_RANGE_BLANK',
                message: `Formula-intended range ${range.displayRange} has a blank cell at ${range.sheetName}!${address}.`,
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
                  ? `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, ${JSON.stringify(expectedFormula)}))`
                  : `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, '=...'))`,
                details: range.label ? { label: range.label } : undefined,
              };
            }
          } else if (typeof value === 'string' && value.trim().startsWith('=')) {
            finding = {
              id: `${check}:${range.sheetId}:${address}`,
              check,
              severity: 'error',
              code: 'FORMULA_LIKE_TEXT_VALUE',
              message: `Cell ${range.sheetName}!${address} contains formula-like text stored as a value.`,
              sheetId: range.sheetId,
              sheetName: range.sheetName,
              address,
              range: range.displayRange,
              row,
              col,
              currentValue: value,
              formula,
              expectedFormula,
              suggestedNextApiCall: `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, ${JSON.stringify(value)}))`,
              details: range.label ? { label: range.label } : undefined,
            };
          } else if (!allowConstants) {
            finding = {
              id: `${check}:${range.sheetId}:${address}`,
              check,
              severity: 'error',
              code: 'HARDCODE_IN_FORMULA_RANGE',
              message: `Formula-intended range ${range.displayRange} has a hardcoded value at ${range.sheetName}!${address}.`,
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
                ? `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, ${JSON.stringify(expectedFormula)}))`
                : `await wb.getSheet(${JSON.stringify(range.sheetName)}).then(ws => ws.setFormula(${JSON.stringify(address)}, '=...'))`,
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

    return validationResult(check, findings, {
      checkedCells,
      checkedRanges,
      truncated,
    });
  }

  async checkWorkbookDirtyState(): Promise<WorkbookValidationResult> {
    const check = 'dirty-state';
    if (!this.deps.isDirty) {
      return unsupportedResult(
        check,
        'Workbook dirty state is unavailable in this diagnostics context.',
        'Pass the workbook dirty-state accessor into WorkbookDiagnosticsImpl.',
      );
    }
    const isDirty = this.deps.isDirty();
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
    return validationResult(check, findings, { checkedRanges: 0, checkedCells: 0 });
  }

  async checkOpenXmlLoadability(): Promise<WorkbookValidationResult> {
    if (this.deps.checkOpenXmlLoadability) {
      return this.deps.checkOpenXmlLoadability();
    }
    return unsupportedResult(
      'openxml-loadability',
      'OpenXML loadability validation requires an XLSX parser callback in this runtime.',
      'Export with wb.toXlsx(), then re-open through the SDK/runtime parser once available.',
    );
  }

  async checkStaleCachedValues(): Promise<WorkbookValidationResult> {
    if (this.deps.checkStaleCachedValues) {
      return this.deps.checkStaleCachedValues();
    }
    return unsupportedResult(
      'stale-cached-values',
      'Stale cached-value validation requires compute metadata that is not exposed in this runtime.',
      'Run await wb.calculate() before export and inspect the CalculateResult.',
    );
  }

  async validateWorkbook(options: ValidateWorkbookOptions = {}): Promise<WorkbookValidationResult> {
    const results: WorkbookValidationResult[] = [];
    if (options.includeFormulaErrorValues ?? true) {
      results.push(await this.checkFormulaErrorValues(options.formulaErrorValues));
    }
    if (options.includeExternalReferences ?? true) {
      results.push(await this.checkExternalReferences(options.externalReferences));
    }
    if (options.blankRegions) {
      results.push(await this.checkBlankRegions(options.blankRegions));
    }
    if (options.formulaShape) {
      results.push(await this.checkFormulaShape(options.formulaShape));
    }
    if (options.includeDirtyState ?? true) {
      results.push(await this.checkWorkbookDirtyState());
    }
    if (options.includeOpenXml ?? false) {
      results.push(await this.checkOpenXmlLoadability());
    }
    if (options.includeStaleValues ?? false) {
      results.push(await this.checkStaleCachedValues());
    }
    return mergeValidationResults(results);
  }

  async getFormulaReferences(
    options: FormulaReferenceDiagnosticsOptions = {},
  ): Promise<FormulaReferenceDiagnosticsPage> {
    const scope = this.ctx.workbookLinkScope();
    const bridgeOptions: BridgeFormulaReferenceDiagnosticsOptions = {
      documentId: scope.requestingDocumentId,
      sheetId: options.sheetId,
      includeWarnings: options.includeWarnings ?? false,
      limit: options.limit,
      cursor: options.cursor,
      externalLinks: this.externalLinkSnapshot(),
    };
    const page = await this.ctx.computeBridge.getFormulaReferenceDiagnostics(bridgeOptions);
    return {
      diagnostics: page.diagnostics.map(projectDiagnostic),
      nextCursor: page.nextCursor,
      snapshotVersion: page.snapshotVersion,
    };
  }

  async getResolvedChartSpec(
    options: ResolvedChartSpecDiagnosticsOptions,
  ): Promise<ResolvedChartSpecSnapshot> {
    const normalized = normalizeImageExportOptions(options.exportOptions);
    const snapshot = await this.ctx.charts.getRenderSnapshotAtSize(
      toSheetId(options.sheetId),
      options.chartId,
      normalized.width,
      normalized.height,
      exportOptionsSnapshot(normalized),
    );

    if ('code' in snapshot) {
      if (snapshot.code === 'CHART_NOT_FOUND') throw chartNotFound(options.chartId);
      throw operationFailed('getResolvedChartSpec', snapshot.message);
    }

    return snapshot.resolvedChartSpec;
  }

  async materialization(): Promise<MaterializationState> {
    return this.ctx.getMaterializationState();
  }

  async import(): Promise<readonly ImportDiagnosticDto[]> {
    const diagnostics = await this.ctx.computeBridge.getImportDiagnostics();
    return diagnostics.map(projectImportDiagnostic);
  }

  async runtime(options: RuntimeDiagnosticsOptions = {}): Promise<RuntimeDiagnosticsPage> {
    const getRuntimeDiagnostics = this.ctx.computeBridge.getRuntimeDiagnostics?.bind(
      this.ctx.computeBridge,
    );
    if (getRuntimeDiagnostics) {
      const page = await getRuntimeDiagnostics(options);
      return {
        diagnostics: page.diagnostics.map(projectRuntimeOperationDiagnostic),
        nextSequence: page.nextSequence,
        truncated: page.truncated,
      };
    }

    const mutationHandler = this.ctx.computeBridge.getMutationHandler?.();
    return mutationHandler?.getRuntimeDiagnostics(options) ?? { diagnostics: [], truncated: false };
  }

  private externalLinkSnapshot(): ExternalLinkStatusSnapshot {
    const scope = this.ctx.workbookLinkScope();
    const records = this.ctx.workbookLinks.list().map((link) => {
      const status = this.ctx.workbookLinks.getStatus(link.linkId, scope);
      return {
        linkId: link.linkId,
        status: status.status,
        statusReason: status.statusReason,
        safeDisplayName: link.displayName || link.linkId,
      };
    });
    const version = records
      .map((record) => `${record.linkId}:${record.status}:${record.statusReason ?? ''}`)
      .sort()
      .join('|');
    return { version: version || 'empty', records };
  }

  private async resolveScanRanges(
    options: WorkbookValidationScanOptions,
    check: WorkbookValidationCheckKind,
  ): Promise<{ ranges: ResolvedValidationRange[] } | { result: WorkbookValidationResult }> {
    if (options.ranges?.length) {
      return this.resolveExplicitRanges(options.ranges, check);
    }
    if (options.range) {
      return this.resolveExplicitRanges(
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
      const sheet = await this.resolveSheet(options.sheetId, options.sheetName);
      if (!sheet) {
        return {
          result: validationResult(check, [
            invalidConfigFinding(
              check,
              `Sheet ${options.sheetId ?? options.sheetName ?? ''} could not be resolved.`,
            ),
          ]),
        };
      }
      const bounds = await this.ctx.computeBridge.getDataBounds(sheet.sheetId);
      if (!bounds) return { ranges: [] };
      return {
        ranges: [
          {
            ...sheet,
            ...boundsToRange(bounds),
            displayRange: rangeToA1({ sheetId: sheet.sheetId, ...boundsToRange(bounds) }, false),
            request: { sheetId: sheet.sheetId, range: '' },
          },
        ],
      };
    }

    const sheets = await this.listSheets();
    const ranges: ResolvedValidationRange[] = [];
    for (const sheet of sheets) {
      const bounds = await this.ctx.computeBridge.getDataBounds(sheet.sheetId);
      if (!bounds) continue;
      ranges.push({
        ...sheet,
        ...boundsToRange(bounds),
        displayRange: rangeToA1({ sheetId: sheet.sheetId, ...boundsToRange(bounds) }, false),
        request: { sheetId: sheet.sheetId, range: '' },
      });
    }
    return { ranges };
  }

  private async resolveExplicitRanges(
    requests: readonly WorkbookValidationRangeRequest[],
    check: WorkbookValidationCheckKind,
  ): Promise<{ ranges: ResolvedValidationRange[] } | { result: WorkbookValidationResult }> {
    const ranges: ResolvedValidationRange[] = [];
    const findings: WorkbookValidationFinding[] = [];

    for (const request of requests) {
      const parsed = parseCellRange(request.range);
      if (!parsed) {
        findings.push(invalidConfigFinding(check, `Invalid range: ${request.range}`));
        continue;
      }
      const sheet = await this.resolveSheet(request.sheetId, request.sheetName ?? parsed.sheetName);
      if (!sheet) {
        findings.push(
          invalidConfigFinding(
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
      return { result: validationResult(check, findings, { checkedRanges: ranges.length }) };
    }
    return { ranges };
  }

  private async resolveSheet(sheetId?: SheetId, sheetName?: string): Promise<ResolvedSheet | null> {
    if (sheetId) {
      const name = await this.ctx.computeBridge.getSheetName(sheetId);
      return name == null ? null : { sheetId, sheetName: name };
    }

    const sheets = await this.listSheets();
    if (sheetName) {
      const lower = sheetName.toLowerCase();
      return sheets.find((sheet) => sheet.sheetName.toLowerCase() === lower) ?? null;
    }
    return sheets.length === 1 ? sheets[0] : null;
  }

  private async listSheets(): Promise<ResolvedSheet[]> {
    const ids = await this.ctx.computeBridge.getAllSheetIds();
    return Promise.all(
      ids.map(async (id) => ({
        sheetId: id,
        sheetName: (await this.ctx.computeBridge.getSheetName(id)) ?? id,
      })),
    );
  }

  private cellFinding(
    check: WorkbookValidationCheckKind,
    severity: WorkbookValidationFinding['severity'],
    code: string,
    range: ResolvedValidationRange,
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
}

interface ResolvedSheet {
  readonly sheetId: SheetId;
  readonly sheetName: string;
}

interface ResolvedValidationRange extends ResolvedSheet {
  readonly startRow: number;
  readonly startCol: number;
  readonly endRow: number;
  readonly endCol: number;
  readonly displayRange: string;
  readonly label?: string;
  readonly request: WorkbookValidationRangeRequest;
}

function normalizeLimit(limit: number | undefined): number {
  if (!Number.isFinite(limit) || limit == null || limit <= 0) return DEFAULT_FINDING_LIMIT;
  return Math.floor(limit);
}

function validationResult(
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

function unsupportedResult(
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

function invalidConfigFinding(
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

function mergeValidationResults(results: WorkbookValidationResult[]): WorkbookValidationResult {
  const checks = results.flatMap((result) => result.checks);
  const findings = results.flatMap((result) => result.findings);
  return {
    ok: results.every((result) => result.ok),
    checks,
    findings,
    truncated: results.some((result) => result.truncated),
  };
}

function boundsToRange(bounds: {
  minRow: number;
  minCol: number;
  maxRow: number;
  maxCol: number;
}): Pick<ResolvedValidationRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'> {
  return {
    startRow: bounds.minRow,
    startCol: bounds.minCol,
    endRow: bounds.maxRow,
    endCol: bounds.maxCol,
  };
}

function rangeCellCount(
  range: Pick<ResolvedValidationRange, 'startRow' | 'startCol' | 'endRow' | 'endCol'>,
): number {
  return (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
}

function cellKey(row: number, col: number): string {
  return `${row}:${col}`;
}

function isBlankValue(value: CellValuePrimitive | null, treatWhitespaceAsBlank: boolean): boolean {
  return (
    value == null ||
    value === '' ||
    (treatWhitespaceAsBlank && typeof value === 'string' && value.trim() === '')
  );
}

function projectRuntimeOperationDiagnostic(
  diagnostic: BridgeRuntimeOperationDiagnostic,
): RuntimeOperationDiagnostic {
  return {
    ...diagnostic,
    severity: diagnostic.severity === 'error' ? 'error' : 'warning',
    filterKind: projectRuntimeFilterKind(diagnostic.filterKind),
  };
}

function projectRuntimeFilterKind(
  value: string | undefined,
): RuntimeOperationDiagnostic['filterKind'] {
  if (value === 'autoFilter' || value === 'tableFilter' || value === 'advancedFilter') {
    return value;
  }
  return undefined;
}

function projectDiagnostic(
  diagnostic: BridgeFormulaReferenceDiagnostic,
): FormulaReferenceDiagnostic {
  return diagnostic as unknown as FormulaReferenceDiagnostic;
}

function exportOptionsSnapshot(
  normalized: ReturnType<typeof normalizeImageExportOptions>,
): ChartExportOptionsSnapshot {
  if (normalized.kind === 'vector') {
    return {
      kind: normalized.kind,
      format: normalized.format,
      width: normalized.width,
      height: normalized.height,
      backgroundColor: normalized.backgroundColor,
      fittingMode: normalized.fittingMode,
      frame: normalized.frame,
    };
  }

  return {
    kind: normalized.kind,
    format: normalized.format,
    width: normalized.width,
    height: normalized.height,
    pixelRatio: normalized.pixelRatio,
    physicalWidth: normalized.physicalWidth,
    physicalHeight: normalized.physicalHeight,
    backgroundColor: normalized.backgroundColor,
    quality: normalized.quality,
    fittingMode: normalized.fittingMode,
    frame: normalized.frame,
  };
}
