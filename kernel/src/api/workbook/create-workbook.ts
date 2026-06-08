/**
 * createWorkbook() — Public Factory Dispatcher
 *
 * Extracted from `workbook-impl.ts` so the zero-ceremony "bootstrap" path (which
 * depends on `DocumentFactory`) does not introduce a `workbook-impl ↔
 * document-factory` cycle. `workbook-impl.ts` now exports only the class plus
 * `createWorkbookFromConfig` (the power-user path with no dependency on
 * document-factory); the overloaded `createWorkbook()` dispatcher and the
 * bootstrap helper live here.
 */

import type { Workbook } from '@mog-sdk/contracts/api';
import type { DocumentImportOptions, DocumentImportWarning } from '@mog-sdk/contracts/document';
import { KernelError } from '../../errors';
import { DocumentFactory, type DocumentHandle } from '../document/document-factory';
import { resolveUserTimezone } from '../document/resolve-user-timezone';
import { createWorkbookFromConfig } from './workbook-impl';
import type { CreateWorkbookOptions, WorkbookConfig } from './types';

/**
 * Create a Workbook by bootstrapping everything from a CreateWorkbookOptions.
 *
 * This is the zero-ceremony path: creates a DocumentHandle and internal active
 * sheet tracking. The returned Workbook owns the DocumentHandle
 * and disposes it on wb.dispose().
 */
async function createWorkbookWithBootstrap(options: CreateWorkbookOptions): Promise<Workbook> {
  let handle: DocumentHandle;
  let importWarnings: DocumentImportWarning[] = [];

  // Auto-detect headless environment (Node.js — no window/document globals)
  const environment =
    typeof window === 'undefined' || typeof document === 'undefined'
      ? ('headless' as const)
      : ('browser' as const);

  const userTimezone = resolveUserTimezone(options.userTimezone, environment);

  // Normalize xlsx shorthand → source
  const source = options.xlsx ? { type: 'bytes' as const, data: options.xlsx } : options.source;

  if (source) {
    // Import from XLSX source
    const result = await DocumentFactory.createFromXlsx(source, {
      ...options.importOptions,
      documentId: options.documentId,
      environment,
      security: options.security,
      userTimezone,
    });
    if (!result.success || !result.handle) {
      throw new KernelError(
        'COMPUTE_ERROR',
        `Failed to create workbook from source: ${result.error?.message ?? 'unknown error'}`,
      );
    }
    handle = result.handle;
    importWarnings = result.warnings;
  } else {
    // Create a blank document
    handle = await DocumentFactory.create({
      documentId: options.documentId,
      environment,
      security: options.security,
      userTimezone,
    });
  }

  // Create the workbook through the document handle so document disposal can
  // synchronously invalidate this facade and its child handles.
  const wb = await handle.workbook({
    previouslySaved: !!source,
    importWarnings,
    writeFile: options.writeFile,
  });

  // Wrap lifecycle close paths to also clean up the owned DocumentHandle.
  const originalDispose = wb.dispose.bind(wb);
  const originalSave = wb.save.bind(wb);
  wb.dispose = () => {
    originalDispose();
    void handle.dispose().catch((err) => {
      console.error('[createWorkbook] handle dispose failed:', err);
    });
  };
  wb.close = async (closeBehavior?: 'save' | 'skipSave') => {
    if (closeBehavior === 'save') {
      await originalSave();
    }
    originalDispose();
    await handle.dispose();
  };
  wb[Symbol.asyncDispose] = async () => {
    originalDispose();
    await handle.dispose();
  };

  return wb;
}

// =============================================================================
// Public Factory — Overloaded createWorkbook()
// =============================================================================

/**
 * Create a unified Workbook instance.
 *
 * @internal SDK consumers should use the SDK's createWorkbook() which adds file-path support.
 *
 * ```typescript
 * const wb = await createWorkbook();                                    // blank
 * const wb = await createWorkbook(xlsxBytes);                           // from buffer
 * const wb = await createWorkbook(xlsxBytes, { valuesOnly: true });     // with options
 * const wb = await createWorkbook({ xlsx: buf, documentId: 'my-doc' }); // options bag
 * const wb = await createWorkbook({ ctx, eventBus, stateProvider });    // power user
 * ```
 */
export async function createWorkbook(): Promise<Workbook>;
export async function createWorkbook(xlsx: Uint8Array): Promise<Workbook>;
export async function createWorkbook(
  xlsx: Uint8Array,
  importOptions: DocumentImportOptions,
): Promise<Workbook>;
export async function createWorkbook(options: CreateWorkbookOptions): Promise<Workbook>;
export async function createWorkbook(config: WorkbookConfig): Promise<Workbook>;
export async function createWorkbook(
  arg?: Uint8Array | CreateWorkbookOptions | WorkbookConfig,
  importOptions?: DocumentImportOptions,
): Promise<Workbook> {
  // No argument — blank workbook
  if (!arg) {
    return createWorkbookWithBootstrap({});
  }

  // Uint8Array / Buffer — XLSX bytes
  if (arg instanceof Uint8Array) {
    return createWorkbookWithBootstrap({
      source: { type: 'bytes', data: arg },
      importOptions,
    });
  }

  // WorkbookConfig — power-user path with pre-existing context
  if ('ctx' in arg && 'eventBus' in arg) {
    return createWorkbookFromConfig(arg as WorkbookConfig);
  }

  // CreateWorkbookOptions — options bag
  return createWorkbookWithBootstrap(arg as CreateWorkbookOptions);
}
