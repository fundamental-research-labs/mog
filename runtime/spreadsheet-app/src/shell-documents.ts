import { installChartImageExporter } from '@mog/app-spreadsheet/services';
import type { DocumentHandle, DocumentHandleWorkbookConfig } from '@mog-sdk/kernel';
import {
  createPublicVersionDomainSupportManifest,
  type DomainSupportManifest,
} from '@mog-sdk/contracts/versioning';
import type { ShellBootstrapResult } from '@mog/shell/bootstrap';

import { getSourceFileKind, toDocumentSource } from './bytes';
import { noopDisposable } from './deferred';
import type {
  SpreadsheetRuntimeDocumentVersioningDiagnostic,
  SpreadsheetRuntimeDocumentVersioningReadiness,
  SpreadsheetRuntimeDocumentVersioningProviderSelection,
} from './attachment-runtime';
import type { SpreadsheetDocumentSource } from './public-types';
import type {
  SpreadsheetAppCapabilityRegistry,
  SpreadsheetAppDocumentHandle,
  SpreadsheetAppWorkbook,
} from './runtime-types';

const DEFAULT_VERSIONING_DECORATED_HANDLE: unique symbol = Symbol.for(
  '@mog-sdk/spreadsheet-app.defaultVersioningDecoratedHandle',
) as never;

type ConfigurableSpreadsheetDocumentHandle = SpreadsheetAppDocumentHandle & {
  workbook(config?: DocumentHandleWorkbookConfig): ReturnType<DocumentHandle['workbook']>;
  [DEFAULT_VERSIONING_DECORATED_HANDLE]?: true;
};

type DefaultVersioningDocumentOptions = {
  readonly skipLocalPersistence?: boolean;
};

export type ShellDocumentLoadResult = {
  readonly handle: SpreadsheetAppDocumentHandle;
  readonly documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness;
};

export type ShellDocumentWorkbookResult = {
  readonly workbook: SpreadsheetAppWorkbook;
  readonly documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness;
};

const DEFAULT_VERSION_PROVIDER_SELECTION = {
  kind: 'indexeddb',
  requireDurablePersistence: true,
} as const satisfies SpreadsheetRuntimeDocumentVersioningProviderSelection;
type DefaultVersionProviderSelection = NonNullable<
  NonNullable<DocumentHandleWorkbookConfig['versioning']>['providerSelection']
>;

export function createDefaultDocumentVersioningReadiness(
  documentId: string,
  options?: DefaultVersioningDocumentOptions,
): SpreadsheetRuntimeDocumentVersioningReadiness {
  if (options?.skipLocalPersistence === true) {
    return {
      status: 'skipped',
      providerSelection: null,
      reason: 'local-persistence-skipped',
      diagnostics: [
        {
          code: 'spreadsheet_runtime.default_versioning_skipped',
          severity: 'info',
          message:
            'Default IndexedDB workbook versioning was skipped because local persistence is disabled for this document.',
          details: { documentId, reason: 'skipLocalPersistence' },
        },
      ],
    };
  }

  return {
    status: 'selected',
    providerSelection: DEFAULT_VERSION_PROVIDER_SELECTION,
    diagnostics: [
      {
        code: 'spreadsheet_runtime.default_indexeddb_versioning_selected',
        severity: 'info',
        message: 'Default IndexedDB workbook versioning provider was selected for this document.',
        details: {
          documentId,
          providerKind: DEFAULT_VERSION_PROVIDER_SELECTION.kind,
          requireDurablePersistence: DEFAULT_VERSION_PROVIDER_SELECTION.requireDurablePersistence,
        },
      },
    ],
  };
}

export async function resolveDocumentVersioningReadiness(
  workbook: SpreadsheetAppWorkbook,
  current: SpreadsheetRuntimeDocumentVersioningReadiness,
): Promise<SpreadsheetRuntimeDocumentVersioningReadiness> {
  if (current.status === 'skipped' || current.status === 'failed') return current;

  try {
    const surface = await readVersionSurfaceStatus(workbook);
    return {
      status: 'ready',
      providerSelection: current.providerSelection,
      diagnostics: [...current.diagnostics, ...surface.diagnostics],
      ...(surface.statusRevision ? { statusRevision: surface.statusRevision } : {}),
    };
  } catch (error) {
    return createFailedDocumentVersioningReadiness(current, error, 'version.getSurfaceStatus');
  }
}

export async function materializeSpreadsheetWorkbook(
  handle: SpreadsheetAppDocumentHandle,
  documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness,
): Promise<ShellDocumentWorkbookResult> {
  try {
    const workbook = (await handle.workbook()) as SpreadsheetAppWorkbook;
    return {
      workbook,
      documentVersioning: await resolveDocumentVersioningReadiness(workbook, documentVersioning),
    };
  } catch (error) {
    throw attachDocumentVersioningDiagnostics(
      toError(error),
      createFailedDocumentVersioningReadiness(documentVersioning, error, 'document.workbook'),
    );
  }
}

export function createFailedDocumentVersioningReadiness(
  current: SpreadsheetRuntimeDocumentVersioningReadiness,
  error: unknown,
  operation: string,
): SpreadsheetRuntimeDocumentVersioningReadiness {
  const errorSummary = summarizeError(error);
  return {
    status: 'failed',
    providerSelection: current.providerSelection,
    diagnostics: [
      ...current.diagnostics,
      {
        code: 'spreadsheet_runtime.document_versioning_failed',
        severity: 'error',
        message: `Workbook versioning readiness failed during ${operation}: ${errorSummary.message}`,
        details: {
          operation,
          providerKind: current.providerSelection?.kind ?? null,
        },
      },
    ],
    error: errorSummary,
    ...(current.statusRevision ? { statusRevision: current.statusRevision } : {}),
  };
}

export function attachDocumentVersioningDiagnostics<T extends Error>(
  error: T,
  documentVersioning: SpreadsheetRuntimeDocumentVersioningReadiness,
): T {
  try {
    Object.defineProperties(error, {
      documentVersioning: {
        value: documentVersioning,
        enumerable: true,
        configurable: true,
      },
      diagnostics: {
        value: documentVersioning.diagnostics,
        enumerable: true,
        configurable: true,
      },
    });
  } catch {
    // Preserve the original failure when an external error type owns these fields.
  }
  return error;
}

function decorateHandleWithDefaultIndexedDbVersioning(
  handle: SpreadsheetAppDocumentHandle,
  documentId: string,
  options?: DefaultVersioningDocumentOptions,
): SpreadsheetAppDocumentHandle {
  if (options?.skipLocalPersistence === true) return handle;

  const mutable = handle as ConfigurableSpreadsheetDocumentHandle;
  if (mutable[DEFAULT_VERSIONING_DECORATED_HANDLE]) return handle;

  const originalWorkbook = mutable.workbook.bind(handle);
  mutable.workbook = ((config?: DocumentHandleWorkbookConfig) =>
    originalWorkbook({
      ...config,
      versioning: {
        providerSelection: createDefaultVersionProviderSelection(handle),
        domainSupportManifest: createDefaultDomainSupportManifest(documentId),
        ...config?.versioning,
      },
    })) as ConfigurableSpreadsheetDocumentHandle['workbook'];
  Object.defineProperty(mutable, DEFAULT_VERSIONING_DECORATED_HANDLE, {
    configurable: false,
    enumerable: false,
    value: true,
  });
  return handle;
}

function createDefaultVersionProviderSelection(
  handle: Pick<SpreadsheetAppDocumentHandle, 'isImportDurabilityPending' | 'isReadOnly'>,
): DefaultVersionProviderSelection {
  return {
    ...DEFAULT_VERSION_PROVIDER_SELECTION,
    ...(handle.isReadOnly === true ? { readOnly: true } : {}),
    ...(handle.isImportDurabilityPending === true ? { initializeTiming: 'deferred' as const } : {}),
  };
}

type VersionSurfaceStatus = {
  readonly diagnostics: readonly SpreadsheetRuntimeDocumentVersioningDiagnostic[];
  readonly statusRevision?: string;
};

type WorkbookWithVersionSurface = {
  readonly version?: {
    getSurfaceStatus?: () => Promise<unknown> | unknown;
  };
};

async function readVersionSurfaceStatus(
  workbook: SpreadsheetAppWorkbook,
): Promise<VersionSurfaceStatus> {
  const version = (workbook as WorkbookWithVersionSurface).version;
  if (!version || typeof version.getSurfaceStatus !== 'function') {
    return {
      diagnostics: [
        {
          code: 'spreadsheet_runtime.version_surface_unavailable',
          severity: 'warning',
          message: 'Workbook versioning surface was not available after document open.',
        },
      ],
    };
  }

  const status = await version.getSurfaceStatus();
  if (!isRecord(status)) return { diagnostics: [] };

  return {
    diagnostics: diagnosticsFromVersionSurface(status.diagnostics),
    ...(typeof status.statusRevision === 'string' ? { statusRevision: status.statusRevision } : {}),
  };
}

function diagnosticsFromVersionSurface(
  value: unknown,
): readonly SpreadsheetRuntimeDocumentVersioningDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const diagnostic = diagnosticFromVersionSurface(entry);
    return diagnostic ? [diagnostic] : [];
  });
}

function diagnosticFromVersionSurface(
  value: unknown,
): SpreadsheetRuntimeDocumentVersioningDiagnostic | null {
  if (!isRecord(value) || typeof value.message !== 'string') return null;
  const code = typeof value.code === 'string' ? value.code : 'version_surface_diagnostic';
  return {
    code,
    severity: toRuntimeDiagnosticSeverity(value.severity),
    message: value.message,
    ...(typeof value.dependency === 'string' ? { details: { dependency: value.dependency } } : {}),
  };
}

function toRuntimeDiagnosticSeverity(
  value: unknown,
): SpreadsheetRuntimeDocumentVersioningDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'fatal'
    ? value
    : 'warning';
}

function summarizeError(error: unknown): { readonly message: string; readonly name?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      ...(error.name ? { name: error.name } : {}),
    };
  }
  return { message: String(error) };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function createDefaultDomainSupportManifest(documentId: string): DomainSupportManifest {
  return createPublicVersionDomainSupportManifest({ workbookId: documentId });
}

export function createPermissiveCapabilityRegistry(): SpreadsheetAppCapabilityRegistry {
  const grants = new Map<string, Set<string>>();
  const listeners = new Set<(event: unknown) => void>();

  const emit = (event: unknown) => {
    for (const listener of listeners) listener(event);
  };

  const registry = {
    on(_event: string, handler: (event: unknown) => void) {
      listeners.add(handler);
      return noopDisposable();
    },
    once(_event: string, handler: (event: unknown) => void) {
      const wrapped = (event: unknown) => {
        listeners.delete(wrapped);
        handler(event);
      };
      listeners.add(wrapped);
      return noopDisposable();
    },
    hasCapability() {
      return true;
    },
    getGrants() {
      return [];
    },
    getEffectiveCapabilities(appId: string) {
      return [...(grants.get(appId) ?? [])];
    },
    grant(appId: string, capability: string) {
      const set = grants.get(appId) ?? new Set<string>();
      set.add(capability);
      grants.set(appId, set);
      emit({ type: 'capability:granted', appId, capability, timestamp: Date.now() });
    },
    grantBatch(appId: string, capabilities: readonly string[]) {
      for (const capability of capabilities) this.grant(appId, capability);
    },
    revoke(appId: string, capability: string) {
      grants.get(appId)?.delete(capability);
      emit({ type: 'capability:revoked', appId, capability, timestamp: Date.now() });
    },
    revokeAll(appId: string) {
      const count = grants.get(appId)?.size ?? 0;
      grants.delete(appId);
      return count;
    },
    expandCapabilities(capabilities: readonly unknown[]) {
      return [...capabilities];
    },
    isCapabilityScoped() {
      return false;
    },
    getCapabilityScope() {
      return null;
    },
    cleanupExpired() {
      return 0;
    },
    subscribeToApp() {
      return noopDisposable();
    },
    subscribeToAll() {
      return noopDisposable();
    },
    dispose() {
      grants.clear();
      listeners.clear();
    },
    [Symbol.dispose]() {
      this.dispose();
    },
  };

  return registry as unknown as SpreadsheetAppCapabilityRegistry;
}

export function openShellDocument(
  shell: ShellBootstrapResult,
  documentId: string,
  displayName: string,
): void {
  const store = shell.store.getState();
  store.addOpenFileId(documentId);
  store.addFile({
    id: documentId,
    filePath: null,
    displayName,
    isModified: false,
    lastSaved: null,
    documentType: 'spreadsheet',
  });
  store.setActiveFileId(documentId);
  store.setActiveAppId('spreadsheet');
}

export function asSpreadsheetAppDocumentHandle(
  handle: unknown,
  operation: string,
): SpreadsheetAppDocumentHandle {
  const candidate = handle as Partial<SpreadsheetAppDocumentHandle>;
  if (!candidate.eventBus || typeof candidate.eventBus.onAll !== 'function') {
    throw new Error(
      `Spreadsheet app document handle missing runtime internals during ${operation}`,
    );
  }
  if (typeof candidate.registerChartImageExporter !== 'function') {
    throw new Error(
      `Spreadsheet app document handle missing chart image exporter registration during ${operation}`,
    );
  }
  installChartImageExporter(candidate as SpreadsheetAppDocumentHandle);
  return candidate as SpreadsheetAppDocumentHandle;
}

export async function loadDocumentForSource(
  shell: ShellBootstrapResult,
  documentId: string,
  source: SpreadsheetDocumentSource,
  options?: { skipLocalPersistence?: boolean },
): Promise<ShellDocumentLoadResult> {
  const documentVersioning = createDefaultDocumentVersioningReadiness(documentId, options);
  const documentSource = toDocumentSource(source);
  try {
    if (!documentSource) {
      const handle = await shell.documentManager.createDocument(documentId, {
        documentId,
        internal: true,
        skipLocalPersistence: options?.skipLocalPersistence,
      });
      const appHandle = asSpreadsheetAppDocumentHandle(handle, 'createDocument');
      return {
        handle: decorateHandleWithDefaultIndexedDbVersioning(appHandle, documentId, options),
        documentVersioning,
      };
    }

    const loadOptions = {
      kind: getSourceFileKind(source),
      skipLocalPersistence: options?.skipLocalPersistence,
    } as const;
    const handle = await shell.documentManager.loadDocument(
      documentId,
      documentSource,
      loadOptions,
    );
    const appHandle = asSpreadsheetAppDocumentHandle(handle, 'loadDocument');
    return {
      handle: decorateHandleWithDefaultIndexedDbVersioning(appHandle, documentId, options),
      documentVersioning,
    };
  } catch (error) {
    throw attachDocumentVersioningDiagnostics(
      toError(error),
      createFailedDocumentVersioningReadiness(documentVersioning, error, 'document.open'),
    );
  }
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
