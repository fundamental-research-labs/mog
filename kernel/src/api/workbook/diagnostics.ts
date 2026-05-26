import type {
  FormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions,
  FormulaReferenceDiagnosticsPage,
  WorkbookDiagnostics,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import type {
  FormulaReferenceDiagnostic as BridgeFormulaReferenceDiagnostic,
  FormulaReferenceDiagnosticsOptions as BridgeFormulaReferenceDiagnosticsOptions,
  ExternalLinkStatusSnapshot,
} from '../../bridges/compute/compute-types.gen';

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
