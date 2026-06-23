import type {
  CheckErrorsOptions,
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  ImportDiagnosticDto,
  MaterializationState,
  ResolvedChartSpecDiagnosticsOptions,
  RuntimeDiagnosticsOptions,
  RuntimeDiagnosticsPage,
  ValidateWorkbookOptions,
  WorkbookBlankRegionCheckInput,
  WorkbookDiagnostics,
  WorkbookExternalReferenceCheckOptions,
  WorkbookFormulaShapeCheckInput,
  WorkbookValidationResult,
  WorkbookValidationScanOptions,
} from '@mog-sdk/contracts/api';
import { normalizeImageExportOptions } from '@mog/charts/export';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ResolvedChartSpecSnapshot } from '@mog-sdk/contracts/data/charts';

import type { DocumentContext } from '../../context';
import type { FormulaReferenceDiagnosticsOptions as BridgeFormulaReferenceDiagnosticsOptions } from '../../bridges/compute/compute-types.gen';
import { chartNotFound, operationFailed } from '../../errors/api';
import { projectImportDiagnostic } from '../document/import-diagnostics';
import type { WorkbookDiagnosticsDeps } from './diagnostics-deps';
import { checkWorkbookExternalReferences } from './diagnostics-external-reference-check';
import { buildWorkbookDiagnosticExternalLinkSnapshot } from './diagnostics-external-links';
import {
  projectFormulaReferenceDiagnostic,
  projectRuntimeOperationDiagnostic,
  toChartExportOptionsSnapshot,
} from './diagnostics-projections';
import {
  checkWorkbookBlankRegions,
  checkWorkbookDirtyState,
  checkWorkbookFormulaErrorValues,
  checkWorkbookFormulaShape,
  checkWorkbookOpenXmlLoadability,
  checkWorkbookStaleCachedValues,
  validateWorkbookDiagnostics,
} from './diagnostics-validation-checks';

export type { WorkbookDiagnosticsDeps } from './diagnostics-deps';

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
    return checkWorkbookFormulaErrorValues(this.ctx, options);
  }

  async checkExternalReferences(
    options: WorkbookExternalReferenceCheckOptions = {},
  ): Promise<WorkbookValidationResult> {
    return checkWorkbookExternalReferences(
      this.ctx,
      (referenceOptions) => this.getFormulaReferences(referenceOptions),
      options,
    );
  }

  async checkBlankRegions(input: WorkbookBlankRegionCheckInput): Promise<WorkbookValidationResult> {
    return checkWorkbookBlankRegions(this.ctx, input);
  }

  async checkFormulaShape(
    input: WorkbookFormulaShapeCheckInput,
  ): Promise<WorkbookValidationResult> {
    return checkWorkbookFormulaShape(this.ctx, input);
  }

  async checkWorkbookDirtyState(): Promise<WorkbookValidationResult> {
    return checkWorkbookDirtyState(this.deps);
  }

  async checkOpenXmlLoadability(): Promise<WorkbookValidationResult> {
    return checkWorkbookOpenXmlLoadability(this.deps);
  }

  async checkStaleCachedValues(): Promise<WorkbookValidationResult> {
    return checkWorkbookStaleCachedValues(this.deps);
  }

  async validateWorkbook(options: ValidateWorkbookOptions = {}): Promise<WorkbookValidationResult> {
    return validateWorkbookDiagnostics(
      {
        checkFormulaErrorValues: (checkOptions) => this.checkFormulaErrorValues(checkOptions),
        checkExternalReferences: (checkOptions) => this.checkExternalReferences(checkOptions),
        checkBlankRegions: (input) => this.checkBlankRegions(input),
        checkFormulaShape: (input) => this.checkFormulaShape(input),
        checkWorkbookDirtyState: () => this.checkWorkbookDirtyState(),
        checkOpenXmlLoadability: () => this.checkOpenXmlLoadability(),
        checkStaleCachedValues: () => this.checkStaleCachedValues(),
      },
      options,
    );
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
      externalLinks: buildWorkbookDiagnosticExternalLinkSnapshot(this.ctx),
    };
    const page = await this.ctx.computeBridge.getFormulaReferenceDiagnostics(bridgeOptions);
    return {
      diagnostics: page.diagnostics.map(projectFormulaReferenceDiagnostic),
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
      toChartExportOptionsSnapshot(normalized),
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
}
