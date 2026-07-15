/**
 * MogDocumentFactory — Public SDK document creation API.
 *
 * Implements IMogDocumentFactory from the contracts package.
 * Delegates to the internal DocumentFactory and wraps results
 * as MogDocument via createMogDocument.
 */

import type {
  IMogDocumentFactory,
  MogDocumentCreateOptions,
  MogDocumentImportOptions,
  MogDocumentOpenResult,
  MogImportResult,
} from '@mog-sdk/contracts/sdk';
import type { DocumentSecurityConfig } from '@mog-sdk/contracts/security';
import { DocumentFactory } from './document-factory';
import { mapDocumentImportWarningToMogImportWarning } from './import-diagnostics';
import { createMogDocument } from './mog-document-impl';
import { callWithPublicSdkErrorBoundary } from '../public-sdk-error-boundary';

// ---------------------------------------------------------------------------
// Option mapping helpers
// ---------------------------------------------------------------------------

function mapSecurity(
  security: MogDocumentCreateOptions['security'],
): DocumentSecurityConfig | undefined {
  if (!security) return undefined;
  return {
    resolvePrincipal: () => {
      const sdkPrincipal = security.resolvePrincipal();
      return { tags: [...sdkPrincipal.tags] };
    },
  };
}

// ---------------------------------------------------------------------------
// MogDocumentFactory
// ---------------------------------------------------------------------------

const mogDocumentFactory: IMogDocumentFactory = {
  async create(options?: MogDocumentCreateOptions) {
    const handle = await DocumentFactory.create({
      documentId: options?.documentId,
      environment: options?.runtime?.kind,
      userTimezone: options?.runtime?.userTimezone,
      security: mapSecurity(options?.security),
    });
    return createMogDocument(handle);
  },

  async open(options: MogDocumentImportOptions): Promise<MogDocumentOpenResult> {
    const source = options.source;

    // -- blank source: delegate to create() ----------------------------------
    if (source.type === 'blank') {
      const doc = await this.create(options);
      const importResult: MogImportResult = {
        success: true,
        sheetIds: [doc.initialSheetId],
        warnings: [],
      };
      return { document: doc, importResult };
    }

    // -- snapshot / updateLog: internal-only for now -------------------------
    if (source.type === 'snapshot' || source.type === 'updateLog') {
      return {
        document: undefined,
        importResult: {
          success: false,
          sheetIds: [],
          warnings: [],
          error: {
            code: 'UNSUPPORTED_SOURCE',
            message: `Source type '${source.type}' is not yet supported in the public SDK.`,
          },
        },
      };
    }

    if (source.type === 'path') {
      return {
        document: undefined,
        importResult: {
          success: false,
          sheetIds: [],
          warnings: [],
          error: {
            code: 'UNSUPPORTED_SOURCE',
            message:
              'Path sources are not accepted by the public SDK import path; use host-backed source resolvers/materializers or pass bytes.',
          },
        },
      };
    }

    if (source.type !== 'bytes') {
      return {
        document: undefined,
        importResult: {
          success: false,
          sheetIds: [],
          warnings: [],
          error: {
            code: 'UNSUPPORTED_SOURCE',
            message: `Unsupported document source type '${String((source as { type?: unknown }).type)}'.`,
          },
        },
      };
    }

    // -- bytes sources -------------------------------------------------------
    const format = source.format ?? 'xlsx';

    const docSource = { type: 'bytes' as const, data: source.data };

    const importOpts = options.importOptions;

    const factoryOptions = {
      documentId: options.documentId,
      environment: options.runtime?.kind,
      userTimezone: options.runtime?.userTimezone,
      security: mapSecurity(options.security),
      maxCells: importOpts?.maxCells,
      valuesOnly: importOpts?.valuesOnly,
      skipFormatting: importOpts?.skipFormatting,
      signal: importOpts?.signal,
      onProgress: importOpts?.onProgress
        ? (p: { percentage: number }) => {
            importOpts.onProgress!({
              phase: 'processing',
              sheetsProcessed: 0,
              totalSheets: 0,
              cellsProcessed: 0,
              totalCells: 0,
              percentage: p.percentage,
            });
          }
        : undefined,
    };

    if (format === 'csv') {
      const result = await DocumentFactory.createFromCsv(docSource, {
        ...factoryOptions,
        csvOptions: importOpts?.csv
          ? {
              delimiter: importOpts.csv.delimiter,
              encoding: importOpts.csv.encoding,
              hasHeaderRow: importOpts.csv.hasHeaderRow,
              maxRows: importOpts.csv.maxRows,
              maxCols: importOpts.csv.maxCols,
            }
          : undefined,
      });

      if (!result.success || !result.handle) {
        return {
          document: undefined,
          importResult: {
            success: false,
            sheetIds: result.sheetIds,
            warnings: result.warnings.map(mapDocumentImportWarningToMogImportWarning),
            error: result.error
              ? { code: 'IMPORT_FAILED', message: result.error.message }
              : undefined,
          },
        };
      }

      const doc = createMogDocument(result.handle);
      return {
        document: doc,
        importResult: {
          success: true,
          sheetIds: result.sheetIds,
          warnings: result.warnings.map(mapDocumentImportWarningToMogImportWarning),
        },
      };
    }

    // Default: xlsx / ooxml
    const result = await DocumentFactory.createFromXlsx(docSource, factoryOptions);

    if (!result.success || !result.handle) {
      return {
        document: undefined,
        importResult: {
          success: false,
          sheetIds: result.sheetIds,
          warnings: result.warnings.map(mapDocumentImportWarningToMogImportWarning),
          error: result.error
            ? { code: 'IMPORT_FAILED', message: result.error.message }
            : undefined,
        },
      };
    }

    const doc = createMogDocument(result.handle);
    return {
      document: doc,
      importResult: {
        success: true,
        sheetIds: result.sheetIds,
        warnings: result.warnings.map(mapDocumentImportWarningToMogImportWarning),
      },
    };
  },
};

const create: IMogDocumentFactory['create'] = (options) =>
  callWithPublicSdkErrorBoundary(
    'MogDocumentFactory.create',
    () => mogDocumentFactory.create(options),
    'MogDocument',
  );

const open: IMogDocumentFactory['open'] = (options) =>
  callWithPublicSdkErrorBoundary('MogDocumentFactory.open', () => mogDocumentFactory.open(options));

export const MogDocumentFactory: IMogDocumentFactory = Object.freeze({ create, open });
