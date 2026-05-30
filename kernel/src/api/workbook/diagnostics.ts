import type {
  FormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  ResolvedChartSpecDiagnosticsOptions,
  WorkbookDiagnostics,
} from '@mog-sdk/contracts/api';
import { normalizeImageExportOptions } from '@mog/charts/export';
import { sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type {
  ChartExportOptionsSnapshot,
  ResolvedChartSpecSnapshot,
} from '@mog-sdk/contracts/data/charts';

import type { DocumentContext } from '../../context';
import type {
  FormulaReferenceDiagnostic as BridgeFormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions as BridgeFormulaReferenceDiagnosticsOptions,
  ExternalLinkStatusSnapshot,
} from '../../bridges/compute/compute-types.gen';
import { chartNotFound, operationFailed } from '../../errors/api';

export class WorkbookDiagnosticsImpl implements WorkbookDiagnostics {
  constructor(private readonly ctx: DocumentContext) {}

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
}

function projectDiagnostic(
  diagnostic: BridgeFormulaReferenceDiagnostic,
): FormulaReferenceDiagnostic {
  return diagnostic as unknown as FormulaReferenceDiagnostic;
}

function exportOptionsSnapshot(
  normalized: ReturnType<typeof normalizeImageExportOptions>,
): ChartExportOptionsSnapshot {
  return {
    format: normalized.format,
    width: normalized.width,
    height: normalized.height,
    pixelRatio: normalized.pixelRatio,
    physicalWidth: normalized.physicalWidth,
    physicalHeight: normalized.physicalHeight,
    backgroundColor: normalized.backgroundColor,
    quality: normalized.quality,
  };
}
