import type { SheetId } from '@mog-sdk/contracts/core';
import type { DocumentImportOptions, DocumentSource } from '@mog-sdk/contracts/document';
import { LegacyOptionRejectedError } from '../../errors/document';
import type { XlsxDocumentImportEnvironment } from './xlsx-document-import-types';

export const INTERNAL_INTERACTIVE_DEFERRED_IMPORT: unique symbol = Symbol(
  'mog.internalInteractiveDeferredImport',
);

export type InteractiveDeferredImportToken = typeof INTERNAL_INTERACTIVE_DEFERRED_IMPORT;

export function rejectLegacyOptions(
  options: DocumentImportOptions | undefined,
  environment: XlsxDocumentImportEnvironment,
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

export function assertSupportedImportSource(
  source: DocumentSource,
  environment: XlsxDocumentImportEnvironment,
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

export function rejectPublicInteractiveDeferredOption(
  options: DocumentImportOptions | undefined,
): void {
  if (!options || !('internalInteractiveDeferred' in (options as Record<string, unknown>))) {
    return;
  }

  throw invalidInteractiveDeferredOptionError(
    'internalInteractiveDeferred is an internal kernel option and is not accepted by public import APIs.',
  );
}

export function assertInteractiveDeferredImportToken(token: InteractiveDeferredImportToken): void {
  if (token !== INTERNAL_INTERACTIVE_DEFERRED_IMPORT) {
    throw invalidInteractiveDeferredOptionError(
      'createInteractiveDeferredDocumentFromXlsx requires the internal interactive deferred import token.',
    );
  }
}
