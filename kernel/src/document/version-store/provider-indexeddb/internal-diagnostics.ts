import type { VersionGraphStoreDiagnostic, VersionGraphStoreDiagnosticCode } from '../graph';
import type { WorkbookCommitId } from '../object-digest';
import { normalizeVersionGraphNamespace, type VersionGraphNamespace } from '../object-store';
import type {
  VersionDiagnosticMessageId,
  VersionStoreCapabilities,
  VersionStoreDiagnostic,
  VersionStoreDiagnosticCode,
  VersionStoreLifecycleState,
  VersionStoreMutationGuarantee,
  VersionStoreOperation,
} from '../provider';
import { cloneVersionStoreCapabilities, type VersionAccessContext } from '../provider';
import {
  normalizeVersionDocumentScope,
  normalizeVersionStoreString,
  type VersionDocumentScope,
} from '../registry';

export function mapGraphDiagnostics(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  operation: VersionStoreOperation,
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((item) => {
    const { namespace: _namespace, ...source } = item;
    return versionStoreDiagnostic(item.code, {
      operation,
      refName: item.refName,
      commitId: item.commitId,
      safeMessage: item.message,
      sourceDiagnostics: [source],
      details: item.details,
    });
  });
}

export function versionStoreDiagnostic(
  code: VersionStoreDiagnosticCode,
  options: {
    readonly operation: VersionStoreOperation;
    readonly documentScope?: VersionDocumentScope;
    readonly namespace?: VersionGraphNamespace;
    readonly refName?: string;
    readonly commitId?: WorkbookCommitId;
    readonly safeMessage: string;
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly mutationGuarantee?: VersionStoreMutationGuarantee;
    readonly lifecycleState?: VersionStoreLifecycleState;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
    readonly sourceDiagnostics?: readonly VersionGraphStoreDiagnostic[];
  },
): VersionStoreDiagnostic {
  return Object.freeze({
    code,
    issueCode: code,
    severity:
      code === 'VERSION_PROVIDER_FAILED' || code === 'VERSION_OBJECT_STORE_FAILURE'
        ? 'fatal'
        : 'error',
    recoverability: options.recoverability ?? recoverabilityForCode(code),
    messageTemplateId: messageTemplateIdForCode(code),
    safeMessage: options.safeMessage,
    message: options.safeMessage,
    operation: options.operation,
    redacted: true,
    ...(options.documentScope
      ? { documentScope: normalizeVersionDocumentScope(options.documentScope) }
      : {}),
    ...(options.namespace ? { namespace: normalizeVersionGraphNamespace(options.namespace) } : {}),
    ...(options.refName ? { refName: options.refName } : {}),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
    ...(options.lifecycleState ? { lifecycleState: options.lifecycleState } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.sourceDiagnostics ? { sourceDiagnostics: options.sourceDiagnostics } : {}),
  });
}

function messageTemplateIdForCode(code: VersionStoreDiagnosticCode): VersionDiagnosticMessageId {
  const ids: Partial<Record<VersionStoreDiagnosticCode, VersionDiagnosticMessageId>> = {
    VERSION_STORE_UNAVAILABLE: 'version.store.unavailable',
    VERSION_PROVIDER_FAILED: 'version.provider.failed',
    VERSION_STORE_READ_ONLY: 'version.store.read-only',
    VERSION_GRAPH_UNINITIALIZED: 'version.graph.uninitialized',
    VERSION_GRAPH_CONFLICT: 'version.graph.conflict',
    VERSION_UNSUPPORTED_REGISTRY: 'version.registry.unsupported',
    VERSION_CORRUPT_REGISTRY: 'version.registry.corrupt',
    VERSION_WRONG_NAMESPACE: 'version.integrity.wrong-namespace',
    VERSION_MISSING_OBJECT: 'version.integrity.missing-object',
    VERSION_MISSING_PARENT: 'version.integrity.missing-parent',
    VERSION_MISSING_CHANGE_SET: 'version.integrity.missing-change-set',
    VERSION_MISSING_DEPENDENCY: 'version.integrity.missing-change-set',
    VERSION_REF_CONFLICT: 'version.ref.conflict',
    VERSION_DANGLING_REF: 'version.ref.dangling',
    VERSION_INVALID_OPTIONS: 'version.options.invalid',
    VERSION_INVALID_COMMIT_ID: 'version.options.invalid',
    VERSION_INVALID_COMMIT_PAYLOAD: 'version.options.invalid',
    VERSION_WRONG_DOCUMENT: 'version.options.invalid',
    VERSION_STALE_PAGE_CURSOR: 'version.page-cursor.stale',
    VERSION_UNSUPPORTED_PAGE_TOKEN: 'version.page-cursor.stale',
    VERSION_UNSUPPORTED_DURABLE_PERSISTENCE: 'version.unsupported',
    VERSION_UNSUPPORTED_PARENT_COMMIT: 'version.unsupported',
    VERSION_OBJECT_STORE_FAILURE: 'version.provider.failed',
  };
  return ids[code] ?? 'version.provider.failed';
}

function recoverabilityForCode(
  code: VersionStoreDiagnosticCode,
): VersionStoreDiagnostic['recoverability'] {
  if (
    code === 'VERSION_STORE_UNAVAILABLE' ||
    code === 'VERSION_GRAPH_CONFLICT' ||
    code === 'VERSION_REF_CONFLICT' ||
    code === 'VERSION_STALE_PAGE_CURSOR'
  )
    return 'retry';
  if (
    code === 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE' ||
    code === 'VERSION_UNSUPPORTED_REGISTRY' ||
    code === 'VERSION_UNSUPPORTED_PARENT_COMMIT' ||
    code === 'VERSION_UNSUPPORTED_PAGE_TOKEN'
  )
    return 'unsupported';
  if (
    code === 'VERSION_CORRUPT_REGISTRY' ||
    code === 'VERSION_DANGLING_REF' ||
    code === 'VERSION_MISSING_OBJECT' ||
    code === 'VERSION_MISSING_PARENT' ||
    code === 'VERSION_MISSING_DEPENDENCY' ||
    code === 'VERSION_MISSING_CHANGE_SET' ||
    code === 'VERSION_OBJECT_STORE_FAILURE'
  )
    return 'repair';
  return 'none';
}

export function graphDiagnostic(
  code: VersionGraphStoreDiagnosticCode,
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionGraphStoreDiagnostic {
  return {
    code,
    severity:
      code === 'VERSION_OBJECT_STORE_FAILURE' ||
      code === 'VERSION_DANGLING_REF' ||
      code === 'VERSION_MISSING_OBJECT'
        ? 'corruption'
        : 'error',
    message,
    ...options,
  };
}

export function readOnlyCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return cloneVersionStoreCapabilities({
    ...capabilities,
    readOnlyHistory: true,
    writes: {
      initializeGraph: false,
      putObjects: false,
      updateRefs: false,
      updateSymbolicRefs: false,
      commitGraphWrite: false,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
    corruptionQuarantine: false,
  });
}

export function normalizeVersionAccessContext(
  accessContext: VersionAccessContext | undefined,
): VersionAccessContext {
  if (accessContext === undefined) return Object.freeze({});
  return Object.freeze({
    ...(accessContext.principalScope === undefined
      ? {}
      : {
          principalScope: normalizeVersionStoreString(
            accessContext.principalScope,
            'accessContext.principalScope',
          ),
        }),
    ...(accessContext.capabilityIds === undefined
      ? {}
      : {
          capabilityIds: Object.freeze(
            [...accessContext.capabilityIds].map((capabilityId, index) =>
              normalizeVersionStoreString(capabilityId, `accessContext.capabilityIds[${index}]`),
            ),
          ),
        }),
    ...(accessContext.diagnosticsAllowed === undefined
      ? {}
      : { diagnosticsAllowed: Boolean(accessContext.diagnosticsAllowed) }),
  });
}
