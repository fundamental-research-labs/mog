import type { VersionGraphStoreDiagnostic } from './graph';
import type { WorkbookCommitId } from './object-digest';
import { normalizeVersionGraphNamespace, type VersionGraphNamespace } from './object-store';
import { normalizeVersionDocumentScope, type VersionDocumentScope } from './registry';
import type {
  VersionDiagnosticMessageId,
  VersionStoreDiagnostic,
  VersionStoreDiagnosticCode,
  VersionStoreLifecycleState,
  VersionStoreMutationGuarantee,
  VersionStoreOperation,
} from './provider-types';

export function mapGraphDiagnostics(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  operation: VersionStoreOperation,
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((item) =>
    versionStoreDiagnostic(item.code, {
      operation,
      namespace: item.namespace,
      refName: item.refName,
      commitId: item.commitId,
      safeMessage: item.message,
      sourceDiagnostics: [item],
      details: item.details,
    }),
  );
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
  const messageTemplateId = messageTemplateIdForCode(code);
  const recoverability = options.recoverability ?? recoverabilityForCode(code);
  return Object.freeze({
    code,
    issueCode: code,
    severity: severityForCode(code),
    recoverability,
    messageTemplateId,
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
  switch (code) {
    case 'VERSION_STORE_UNAVAILABLE':
      return 'version.store.unavailable';
    case 'VERSION_PROVIDER_FAILED':
      return 'version.provider.failed';
    case 'VERSION_STORE_READ_ONLY':
      return 'version.store.read-only';
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'version.graph.uninitialized';
    case 'VERSION_GRAPH_CONFLICT':
      return 'version.graph.conflict';
    case 'VERSION_UNSUPPORTED_REGISTRY':
      return 'version.registry.unsupported';
    case 'VERSION_CORRUPT_REGISTRY':
      return 'version.registry.corrupt';
    case 'VERSION_WRONG_NAMESPACE':
      return 'version.integrity.wrong-namespace';
    case 'VERSION_MISSING_OBJECT':
      return 'version.integrity.missing-object';
    case 'VERSION_MISSING_PARENT':
      return 'version.integrity.missing-parent';
    case 'VERSION_MISSING_CHANGE_SET':
    case 'VERSION_MISSING_DEPENDENCY':
      return 'version.integrity.missing-change-set';
    case 'VERSION_HISTORY_ROOT_POLICY_BLOCKED':
      return 'version.history-root-policy.blocked';
    case 'VERSION_REF_CONFLICT':
      return 'version.ref.conflict';
    case 'VERSION_DANGLING_REF':
      return 'version.ref.dangling';
    case 'VERSION_INVALID_OPTIONS':
    case 'VERSION_INVALID_COMMIT_ID':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_WRONG_DOCUMENT':
      return 'version.options.invalid';
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'version.page-cursor.stale';
    case 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE':
    case 'VERSION_UNSUPPORTED_PARENT_COMMIT':
      return 'version.unsupported';
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'version.provider.failed';
  }
}

function severityForCode(code: VersionStoreDiagnosticCode): VersionStoreDiagnostic['severity'] {
  if (code === 'VERSION_PROVIDER_FAILED' || code === 'VERSION_OBJECT_STORE_FAILURE') {
    return 'fatal';
  }
  return 'error';
}

function recoverabilityForCode(
  code: VersionStoreDiagnosticCode,
): VersionStoreDiagnostic['recoverability'] {
  switch (code) {
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_GRAPH_CONFLICT':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE':
    case 'VERSION_UNSUPPORTED_REGISTRY':
    case 'VERSION_UNSUPPORTED_PARENT_COMMIT':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
    case 'VERSION_HISTORY_ROOT_POLICY_BLOCKED':
      return 'unsupported';
    case 'VERSION_CORRUPT_REGISTRY':
      return 'repair';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_MISSING_CHANGE_SET':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    default:
      return 'none';
  }
}
