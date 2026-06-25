import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import type { VersionStoreProvider } from './provider';
import { namespaceForRegistry } from './registry';
import type {
  VersionPersistenceBoundaryDiagnostic,
  VersionPersistenceBoundaryDiagnosticCode,
  VersionPersistenceBoundaryKind,
  VersionPersistenceBoundaryRequest,
  VersionPersistenceBoundaryResult,
} from './version-persistence-types';

export async function persistVersionPersistenceBoundary(
  provider: VersionStoreProvider | undefined,
  request: VersionPersistenceBoundaryRequest,
): Promise<VersionPersistenceBoundaryResult> {
  const parsed = parseBoundaryRequest(request);
  if (!parsed.ok) return boundaryFailure(parsed.code, parsed.message, parsed.options);

  if (!provider) {
    return boundaryFailure(
      'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE',
      'VersionPersistence.persistBoundary requires a version-store provider.',
      { boundary: parsed.boundary, commitId: parsed.commitId },
    );
  }

  try {
    const registryRead = await provider.readGraphRegistry();
    if (registryRead.status !== 'ok') {
      return boundaryFailure(
        'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE',
        'Visible version graph registry is unavailable for persistence-boundary recovery diagnostics.',
        {
          boundary: parsed.boundary,
          commitId: parsed.commitId,
          sourceDiagnostics: registryRead.diagnostics,
        },
      );
    }

    const namespace = namespaceForRegistry(registryRead.registry);
    const diagnostic = boundaryDiagnostic(
      'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED',
      'Version persistence observed object writes before ref advancement; reload the visible graph before retrying writes.',
      {
        boundary: parsed.boundary,
        ...(parsed.commitId ? { commitId: parsed.commitId } : {}),
        graphId: namespace.graphId,
        recoveryAction: 'reload-visible-graph',
        details: { registryRevision: registryRead.registry.registryRevision.value },
      },
    );
    return Object.freeze({
      ok: true as const,
      status: 'diagnosed' as const,
      boundary: parsed.boundary,
      ...(parsed.commitId ? { commitId: parsed.commitId } : {}),
      graphId: namespace.graphId,
      recoveryAction: 'reload-visible-graph' as const,
      diagnostics: Object.freeze([diagnostic]),
      mutationGuarantee: 'ref-not-mutated' as const,
      retryable: false as const,
    });
  } catch (error) {
    return boundaryFailure(
      'VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE',
      'Visible version graph registry could not be read for persistence-boundary recovery diagnostics.',
      {
        boundary: parsed.boundary,
        commitId: parsed.commitId,
        sourceDiagnostics: [{ cause: errorName(error) }],
      },
    );
  }
}

function parseBoundaryRequest(request: VersionPersistenceBoundaryRequest):
  | {
      readonly ok: true;
      readonly boundary: VersionPersistenceBoundaryKind;
      readonly commitId?: WorkbookCommitId;
    }
  | {
      readonly ok: false;
      readonly code: VersionPersistenceBoundaryDiagnosticCode;
      readonly message: string;
      readonly options?: {
        readonly boundary?: VersionPersistenceBoundaryKind;
        readonly commitId?: WorkbookCommitId;
        readonly details?: VersionPersistenceBoundaryDiagnostic['details'];
      };
    } {
  if (!isRecord(request)) {
    return {
      ok: false,
      code: 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST',
      message: 'Persistence boundary request must be an object.',
    };
  }

  if (request.boundary !== 'segment-written-ref-not-advanced') {
    return {
      ok: false,
      code: 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST',
      message: 'Persistence boundary request names an unsupported boundary.',
      options: {
        details: { boundary: formatUnknown(request.boundary) },
      },
    };
  }

  if (request.commitId === undefined) {
    return { ok: true, boundary: request.boundary };
  }

  try {
    return {
      ok: true,
      boundary: request.boundary,
      commitId: parseWorkbookCommitId(request.commitId),
    };
  } catch {
    return {
      ok: false,
      code: 'VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST',
      message: 'Persistence boundary commitId must be commit:sha256:<64 lowercase hex>.',
      options: {
        boundary: request.boundary,
        details: { field: 'commitId' },
      },
    };
  }
}

function boundaryFailure(
  code: VersionPersistenceBoundaryDiagnosticCode,
  message: string,
  options: {
    readonly boundary?: VersionPersistenceBoundaryKind;
    readonly commitId?: WorkbookCommitId;
    readonly details?: VersionPersistenceBoundaryDiagnostic['details'];
    readonly sourceDiagnostics?: VersionPersistenceBoundaryDiagnostic['sourceDiagnostics'];
  } = {},
): Extract<VersionPersistenceBoundaryResult, { ok: false }> {
  const diagnostics = [
    boundaryDiagnostic(code, message, {
      ...(options.boundary ? { boundary: options.boundary } : {}),
      ...(options.commitId ? { commitId: options.commitId } : {}),
      ...(options.details ? { details: options.details } : {}),
      ...(options.sourceDiagnostics ? { sourceDiagnostics: options.sourceDiagnostics } : {}),
    }),
  ];
  return Object.freeze({
    ok: false as const,
    error: Object.freeze({ code, message, diagnostics }),
    ...(options.boundary ? { boundary: options.boundary } : {}),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    diagnostics,
    mutationGuarantee: 'no-write-attempted' as const,
    retryable: false as const,
  });
}

function boundaryDiagnostic(
  code: VersionPersistenceBoundaryDiagnosticCode,
  message: string,
  options: Omit<VersionPersistenceBoundaryDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionPersistenceBoundaryDiagnostic {
  return Object.freeze({
    code,
    severity: code === 'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED' ? 'warning' : 'error',
    message,
    ...options,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function formatUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  return typeof value;
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
