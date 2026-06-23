import type { DocumentImportResult, DocumentSource } from '@mog-sdk/contracts/document';
import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import { DocumentLifecycleSystem } from '../../document';
import { slog } from '../../lib/slog';
import {
  assertSupportedImportSource,
  rejectLegacyOptions,
  rejectPublicInteractiveDeferredOption,
} from './xlsx-document-import-validation';
import type { DocumentHandleInternal } from './document-handle-types';
import {
  documentImportWarningsFromDiagnostics,
  projectImportDiagnostic,
} from './import-diagnostics';
import { resolveUserTimezone } from './resolve-user-timezone';
import { xlsxImportRootSource } from './xlsx-document-import-provenance';
import type {
  XlsxDocumentImportDependencies as XlsxDocumentImportDependenciesContract,
  XlsxDocumentImportOptions as XlsxDocumentImportOptionsContract,
} from './xlsx-document-import-types';
import { xlsxVersionMetadataTrust } from './xlsx-document-import-version-metadata';

export type { InteractiveDeferredImportToken } from './xlsx-document-import-validation';
export {
  assertInteractiveDeferredImportToken,
  INTERNAL_INTERACTIVE_DEFERRED_IMPORT,
} from './xlsx-document-import-validation';
export type {
  XlsxDocumentHandleFactory,
  XlsxDocumentImportDependencies,
  XlsxDocumentImportEnvironment,
  XlsxDocumentImportOptions,
} from './xlsx-document-import-types';

export async function createFromXlsxDocument<THandle extends DocumentHandleInternal>(
  source: DocumentSource,
  options: XlsxDocumentImportOptionsContract | undefined,
  mode: 'durable' | 'interactiveDeferred',
  deps: XlsxDocumentImportDependenciesContract<THandle>,
): Promise<DocumentImportResult & { handle?: THandle }> {
  let lifecycle: DocumentLifecycleSystem | undefined;

  try {
    const environment = options?.environment ?? 'browser';
    rejectLegacyOptions(options, environment);
    assertSupportedImportSource(source, environment);

    if (mode === 'durable') {
      rejectPublicInteractiveDeferredOption(options);
    }

    const userTimezone = resolveUserTimezone(
      options?.userTimezone,
      environment === 'headless' ? 'headless' : 'browser',
    );
    const requestedDocumentId = options?.documentId ?? deps.generateDocumentId();

    const perfStartTime = performance.now();
    performance.mark('docFactory:createFromXlsx:start');
    lifecycle = new DocumentLifecycleSystem({
      environment: options?.environment,
      napiAddon: options?.napiAddon,
      security: options?.security,
      userTimezone,
      clock: deps.clock,
      workbookLinkScope: {
        requestingDocumentId: requestedDocumentId,
        requestingSessionId: 'unknown-session',
        actor: 'trusted-host',
        principal: { tags: ['host:trusted'] },
      },
    });
    lifecycle.createFromXlsx(requestedDocumentId, { skipDefaultSheet: true }, source, options);
    await lifecycle.waitForReady();

    if (mode === 'durable') {
      await lifecycle.awaitImportDurability();
    }

    performance.mark('docFactory:createFromXlsx:end');
    performance.measure(
      'docFactory:createFromXlsx',
      'docFactory:createFromXlsx:start',
      'docFactory:createFromXlsx:end',
    );

    if (environment !== 'headless') {
      const dlsMeasures = performance
        .getEntriesByType('measure')
        .filter(
          (e) =>
            e.startTime >= perfStartTime &&
            (e.name.startsWith('dls:') || e.name.startsWith('docFactory:')),
        );
      slog('documentFactory.createFromXlsxTimingBreakdown', {
        measures: dlsMeasures.map((m) => ({
          name: m.name,
          durationMs: m.duration,
        })),
      });
    }

    const snap = lifecycle.snapshot;
    const documentId = snap.context.docId;
    const sheetIds = snap.context.initialSheetIds ?? [];
    const context = lifecycle.documentContext as ISpreadsheetKernelContext;
    const versionMetadataTrust = await xlsxVersionMetadataTrust(source, documentId, options);
    const importDiagnostics = [
      ...versionMetadataTrust.diagnostics,
      ...(await lifecycle.computeBridge.getImportDiagnostics()).map(projectImportDiagnostic),
    ];
    const warnings = documentImportWarningsFromDiagnostics(importDiagnostics);
    const handle = deps.createDocumentHandle(documentId, lifecycle, context, undefined, warnings, {
      kind: 'xlsx',
      source: xlsxImportRootSource(source),
      diagnostics: importDiagnostics,
      versionMetadataTrust: versionMetadataTrust.trust,
      ...(versionMetadataTrust.versionMetadataHeadCandidate
        ? { versionMetadataHeadCandidate: versionMetadataTrust.versionMetadataHeadCandidate }
        : {}),
    });

    return {
      success: true,
      sheetIds,
      handle,
      warnings,
    };
  } catch (error) {
    if (lifecycle) {
      lifecycle.dispose().catch(() => {});
    }

    return {
      success: false,
      sheetIds: [],
      error: error instanceof Error ? error : new Error(String(error)),
      warnings: [
        {
          type: 'import_error',
          message: `Import failed: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}
