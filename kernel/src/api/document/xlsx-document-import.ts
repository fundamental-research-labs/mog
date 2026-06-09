import type { SheetId } from '@mog-sdk/contracts/core';
import type {
  DocumentImportOptions,
  DocumentImportResult,
  DocumentImportWarning,
  DocumentSource,
} from '@mog-sdk/contracts/document';
import type { ISpreadsheetKernelContext } from '@mog-sdk/contracts/kernel';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import { DocumentLifecycleSystem } from '../../document';
import type { KernelClock } from '../../context';
import { LegacyOptionRejectedError } from '../../errors/document';
import { slog } from '../../lib/slog';
import type { DocumentHandleInternal } from './document-handle-types';
import {
  documentImportWarningsFromDiagnostics,
  projectImportDiagnostic,
} from './import-diagnostics';
import { resolveUserTimezone } from './resolve-user-timezone';

export const INTERNAL_INTERACTIVE_DEFERRED_IMPORT: unique symbol = Symbol(
  'mog.internalInteractiveDeferredImport',
);

export type InteractiveDeferredImportToken = typeof INTERNAL_INTERACTIVE_DEFERRED_IMPORT;

export type XlsxDocumentImportOptions = DocumentImportOptions & {
  environment?: 'browser' | 'headless';
  napiAddon?: unknown;
  security?: DocumentSecurityConfig;
  userTimezone?: string;
};

export type XlsxDocumentHandleFactory<THandle extends DocumentHandleInternal> = (
  documentId: string,
  lifecycle: DocumentLifecycleSystem,
  context: ISpreadsheetKernelContext,
  collaborationBootstrap?: undefined,
  importWarnings?: readonly DocumentImportWarning[],
) => THandle;

export interface XlsxDocumentImportDependencies<THandle extends DocumentHandleInternal> {
  generateDocumentId(): string;
  clock: KernelClock;
  createDocumentHandle: XlsxDocumentHandleFactory<THandle>;
}

function rejectLegacyOptions(
  options: DocumentImportOptions | undefined,
  environment: 'browser' | 'headless',
): void {
  if (!options) return;

  if (options.providers && options.providers.length > 0) {
    throw new LegacyOptionRejectedError(
      'CreateDocumentOptions.providers is no longer consumed. ' +
        'Provider selection is determined by the runtime environment. ' +
        'Remove the `providers` field from your options.',
    );
  }

  if (environment === 'browser') {
    if (options.yrsState) {
      throw new LegacyOptionRejectedError(
        'CreateDocumentOptions.yrsState is not allowed in browser environment. ' +
          'Use the provider lifecycle (IndexedDB) for state hydration, or pass ' +
          '`environment: "headless"` for collaboration / test paths.',
      );
    }
    if (options.initialSnapshot) {
      throw new LegacyOptionRejectedError(
        'CreateDocumentOptions.initialSnapshot is not allowed in browser environment. ' +
          'Use the provider lifecycle (IndexedDB) for state hydration, or pass ' +
          '`environment: "headless"` for collaboration / test paths.',
      );
    }
  }
}

function assertSupportedImportSource(
  source: DocumentSource,
  environment: 'browser' | 'headless',
): void {
  if (!source || (source.type !== 'bytes' && source.type !== 'path')) {
    throw new LegacyOptionRejectedError(
      `Unsupported DocumentSource kind '${String((source as { type?: unknown } | undefined)?.type)}'. ` +
        'Import sources must be resolved through bytes or a host-backed source resolver.',
    );
  }

  if (source.type === 'path' && environment === 'headless') {
    throw new LegacyOptionRejectedError(
      'DocumentSource.path is not accepted in headless/public Node imports. ' +
        'Resolve paths through host-backed source resolvers/materializers or pass bytes.',
    );
  }
}

function invalidInteractiveDeferredOptionError(message: string): Error {
  const err = new Error(message) as Error & {
    code?: string;
    scope?: SheetId | 'allSheets';
  };
  err.code = 'invalid_interactive_import_option';
  err.scope = 'allSheets';
  return err;
}

function rejectPublicInteractiveDeferredOption(options: DocumentImportOptions | undefined): void {
  if (!options || !('internalInteractiveDeferred' in (options as Record<string, unknown>))) {
    return;
  }

  throw invalidInteractiveDeferredOptionError(
    'internalInteractiveDeferred is an internal kernel option and is not accepted by public import APIs.',
  );
}

export async function createFromXlsxDocument<THandle extends DocumentHandleInternal>(
  source: DocumentSource,
  options: XlsxDocumentImportOptions | undefined,
  mode: 'durable' | 'interactiveDeferred',
  deps: XlsxDocumentImportDependencies<THandle>,
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

    const perfStartTime = performance.now();
    performance.mark('docFactory:createFromXlsx:start');
    lifecycle = new DocumentLifecycleSystem({
      environment: options?.environment,
      napiAddon: options?.napiAddon,
      security: options?.security,
      userTimezone,
      clock: deps.clock,
    });
    lifecycle.createFromXlsx(
      options?.documentId ?? deps.generateDocumentId(),
      { skipDefaultSheet: true },
      source,
      options,
    );
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
    const importDiagnostics = (await lifecycle.computeBridge.getImportDiagnostics()).map(
      projectImportDiagnostic,
    );
    const warnings = documentImportWarningsFromDiagnostics(importDiagnostics);
    const handle = deps.createDocumentHandle(documentId, lifecycle, context, undefined, warnings);

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

export function assertInteractiveDeferredImportToken(token: InteractiveDeferredImportToken): void {
  if (token !== INTERNAL_INTERACTIVE_DEFERRED_IMPORT) {
    throw invalidInteractiveDeferredOptionError(
      'createInteractiveDeferredDocumentFromXlsx requires the internal interactive deferred import token.',
    );
  }
}
