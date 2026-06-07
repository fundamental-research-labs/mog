/**
 * Host Context Validation Gate
 *
 * Comprehensive validation of `KernelHostContext` before any engine, transport,
 * provider, source-byte, or Rust state construction. This is the single
 * construction-time gate that all host-backed document paths must pass through.
 *
 * Fail-closed: every rejection path throws a structured
 * `HostContextConstructionError` and emits diagnostics. Silent continuation
 * is never permitted.
 */

import type { KernelHostContext } from '@mog-sdk/types-host/kernel';
import type { VerifiedPrincipal } from '@mog-sdk/types-host/identity';
import type { HostDiagnosticsSink, HostDiagnosticEvent } from '@mog-sdk/types-host/diagnostics';
import {
  canonicalJsonStringify,
  createHostCanonicalFingerprint,
} from '@mog-sdk/types-host/fingerprints';
import type { HostKernelAdapterBindings } from '@mog-sdk/types-host/bindings';
import type {
  StorageScope,
  StorageScopeBinding,
} from '@mog-sdk/types-document/storage/provider-identity';
import type {
  KernelDocumentLifecycleInput,
  ValidatedAuthorizedStorageHandoff,
  ValidatedKernelRuntimeConfig,
  ValidatedHostKernelAdapterBindings,
  BoundHostDocumentOperationAuthorization,
} from '@mog-sdk/types-host/kernel';
import { HostContextConstructionError } from './errors';

// ---------------------------------------------------------------------------
// Supported runtime kinds for this runtime build
// ---------------------------------------------------------------------------

const SUPPORTED_RUNTIME_KINDS: ReadonlySet<string> = new Set([
  'browser-wasm-worker',
  'headless-wasm',
  'node-napi',
  'tauri-native',
  'test',
]);

const RUNTIME_TRANSPORT_KIND: Readonly<Record<string, string>> = {
  'browser-wasm-worker': 'browser',
  'headless-wasm': 'headless',
  'node-napi': 'headless',
  'tauri-native': 'tauri',
  test: 'test',
};

// ---------------------------------------------------------------------------
// Tenant/workspace marker helpers
// ---------------------------------------------------------------------------

type TenantMarker = string | { readonly kind: 'single-tenant' };
type WorkspaceMarker = string | { readonly kind: 'no-workspace' };

function tenantMarkersMatch(a: TenantMarker, b: TenantMarker): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'object' && typeof b === 'object') return a.kind === b.kind;
  return false;
}

function workspaceMarkersMatch(a: WorkspaceMarker, b: WorkspaceMarker): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a === b;
  if (typeof a === 'object' && typeof b === 'object') return a.kind === b.kind;
  return false;
}

function isSingleTenantMarker(m: TenantMarker): m is { readonly kind: 'single-tenant' } {
  return typeof m === 'object' && m !== null && m.kind === 'single-tenant';
}

function isNoWorkspaceMarker(m: WorkspaceMarker): m is { readonly kind: 'no-workspace' } {
  return typeof m === 'object' && m !== null && m.kind === 'no-workspace';
}

function normalizeStorageScope(
  value: StorageScope | StorageScopeBinding | null | undefined,
): StorageScope | null {
  if (!value) return null;
  if ('kind' in value) {
    return value.kind === 'scoped' ? value.scope : null;
  }
  return value;
}

function formatTenant(m: TenantMarker): string {
  return typeof m === 'string' ? m : JSON.stringify(m);
}

function formatWorkspace(m: WorkspaceMarker): string {
  return typeof m === 'string' ? m : JSON.stringify(m);
}

// ---------------------------------------------------------------------------
// Principal structural comparison
// ---------------------------------------------------------------------------

function principalsStructurallyMatch(a: VerifiedPrincipal, b: VerifiedPrincipal): boolean {
  return (
    a.subjectId === b.subjectId &&
    a.actorKind === b.actorKind &&
    a.issuer.issuerId === b.issuer.issuerId &&
    a.issuer.issuerKind === b.issuer.issuerKind &&
    tenantMarkersMatch(a.tenantId, b.tenantId) &&
    workspaceMarkersMatch(a.workspaceId, b.workspaceId) &&
    canonicalJsonStringify(a.tags) === canonicalJsonStringify(b.tags)
  );
}

// ---------------------------------------------------------------------------
// Storage config safety checks
// ---------------------------------------------------------------------------

/** Patterns that indicate raw secrets, tokens, URLs, file paths, callbacks, or raw bytes. */
const FORBIDDEN_CONFIG_KEYS = new Set([
  'secret',
  'token',
  'password',
  'apiKey',
  'api_key',
  'accessToken',
  'access_token',
  'refreshToken',
  'refresh_token',
  'credential',
  'credentials',
  'privateKey',
  'private_key',
  'connectionString',
  'connection_string',
]);

const FORBIDDEN_CONFIG_KEY_PATTERNS = [
  /secret/i,
  /token/i,
  /password/i,
  /apikey/i,
  /api_key/i,
  /private.?key/i,
  /credential/i,
  /connection.?string/i,
];

function isTypedMaterializationReferenceKey(key: string): boolean {
  return /(?:Ref|Handle|Id)$/.test(key);
}

function stringLooksLikeRawSecret(value: string): boolean {
  const trimmed = value.trim();
  if (/-----BEGIN [A-Z ]*(?:PRIVATE KEY|SECRET|TOKEN)/.test(trimmed)) return true;
  if (/^sk_(?:live|test|proj)_[A-Za-z0-9_-]{16,}$/.test(trimmed)) return true;
  if (/^AKIA[0-9A-Z]{16}$/.test(trimmed)) return true;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return true;
  if (/^[A-Fa-f0-9]{48,}$/.test(trimmed)) return true;
  if (/^[A-Za-z0-9_+/=-]{64,}$/.test(trimmed)) return true;
  return false;
}

function containsForbiddenConfigValues(obj: unknown, path: string = ''): string | null {
  if (obj === null || obj === undefined) return null;

  if (typeof obj === 'function') {
    return `${path}: contains callback/function`;
  }

  if (obj instanceof Uint8Array || obj instanceof ArrayBuffer) {
    return `${path}: contains raw bytes`;
  }

  if (typeof obj === 'string') {
    // Check for raw URLs, file paths, object keys
    if (/^(https?|wss?|ftp):\/\//i.test(obj) && path !== '') {
      return `${path}: contains raw URL`;
    }
    if (/^(\/|[A-Z]:\\|~\/)/i.test(obj) && path !== '') {
      return `${path}: contains raw file path`;
    }
    if (/^s3:\/\/|^gs:\/\/|^az:\/\//i.test(obj)) {
      return `${path}: contains raw object key/URL`;
    }
    if (stringLooksLikeRawSecret(obj)) {
      return `${path}: contains raw secret-like value`;
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = containsForbiddenConfigValues(obj[i], `${path}[${i}]`);
      if (result) return result;
    }
    return null;
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      const fullPath = path ? `${path}.${key}` : key;
      const isTypedRef = isTypedMaterializationReferenceKey(key);

      // Check key name against forbidden patterns
      if (!isTypedRef && FORBIDDEN_CONFIG_KEYS.has(key)) {
        return `${fullPath}: forbidden config key (potential secret)`;
      }
      for (const pattern of FORBIDDEN_CONFIG_KEY_PATTERNS) {
        if (!isTypedRef && pattern.test(key)) {
          return `${fullPath}: forbidden config key pattern (potential secret)`;
        }
      }

      const result = containsForbiddenConfigValues((obj as Record<string, unknown>)[key], fullPath);
      if (result) return result;
    }
    return null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Diagnostics helper
// ---------------------------------------------------------------------------

function emitValidationDiagnostic(
  diagnostics: HostDiagnosticsSink,
  phase: HostDiagnosticEvent & { readonly kind: 'hostConstruction.invalid' } extends never
    ? never
    :
        | 'trusted-context'
        | 'kernel-context'
        | 'principal-projection'
        | 'storage-handoff'
        | 'runtime-config',
  invariant: string,
  success: boolean,
  correlationId: string,
  decisionId: string | undefined,
  sourceHostId: string | undefined,
  reason?: string,
): void {
  if (success) return; // Only emit on failure per the contract
  diagnostics.emit({
    kind: 'hostConstruction.invalid',
    code: `HOST_VALIDATION_${invariant.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
    phase,
    invariant,
    reason: reason ?? `Validation failed: ${invariant}`,
    correlationId,
    decisionId,
    sourceHostId,
    timestamp: Date.now(),
  });
}

// ---------------------------------------------------------------------------
// Main validation gate
// ---------------------------------------------------------------------------

/**
 * Comprehensive validation gate for host-backed document construction.
 *
 * Must be called before `DocumentLifecycleSystem`, engine creation, transport
 * binding, provider materialization, source-byte resolution, or Rust state
 * construction. Returns a `KernelDocumentLifecycleInput` with only the
 * validated fields the lifecycle system needs.
 *
 * Fail-closed: throws `HostContextConstructionError` on any invariant
 * violation and emits diagnostics for every rejection path.
 */
export function validateKernelHostContextForDocument(
  host: KernelHostContext,
  bindings: HostKernelAdapterBindings,
): KernelDocumentLifecycleInput {
  const diagnostics = host?.diagnostics ?? { emit() {} };
  let correlationId = '';
  let decisionId: string | undefined;
  let sourceHostId: string | undefined;

  function fail(code: string, message: string, field?: string): never {
    emitValidationDiagnostic(
      diagnostics,
      'kernel-context',
      code,
      false,
      correlationId,
      decisionId,
      sourceHostId,
      message,
    );
    throw new HostContextConstructionError(code, message, field);
  }

  // -----------------------------------------------------------------------
  // 1. Top-level presence checks
  // -----------------------------------------------------------------------

  if (!host.session) fail('MISSING_SESSION', 'KernelHostContext.session is required', 'session');
  if (!host.principal)
    fail('MISSING_PRINCIPAL', 'KernelHostContext.principal is required', 'principal');
  if (!host.storage) fail('MISSING_STORAGE', 'KernelHostContext.storage is required', 'storage');
  if (!host.runtime) fail('MISSING_RUNTIME', 'KernelHostContext.runtime is required', 'runtime');
  if (!host.diagnostics)
    fail('MISSING_DIAGNOSTICS', 'KernelHostContext.diagnostics is required', 'diagnostics');
  if (!host.clock) fail('MISSING_CLOCK', 'KernelHostContext.clock is required', 'clock');
  if (!host.timezone)
    fail('MISSING_TIMEZONE', 'KernelHostContext.timezone is required', 'timezone');
  if (
    host.workbookLinkResolver != null &&
    typeof host.workbookLinkResolver.resolve !== 'function'
  ) {
    fail(
      'INVALID_WORKBOOK_LINK_RESOLVER',
      'KernelHostContext.workbookLinkResolver.resolve must be a function when provided',
      'workbookLinkResolver.resolve',
    );
  }

  const storage = host.storage;
  correlationId = storage.correlationId ?? '';
  decisionId = storage.decisionId;
  sourceHostId = storage.sourceHostId;

  // -----------------------------------------------------------------------
  // 2. Operation validation
  // -----------------------------------------------------------------------

  const operation = storage.operation;
  if (operation !== 'create' && operation !== 'open' && operation !== 'import') {
    fail(
      'INVALID_OPERATION',
      `storage.operation must be 'create', 'open', or 'import', got '${String(operation)}'`,
      'storage.operation',
    );
  }

  // -----------------------------------------------------------------------
  // 3. Required handoff fields presence
  // -----------------------------------------------------------------------

  if (!storage.decisionId)
    fail('MISSING_DECISION_ID', 'storage.decisionId is required', 'storage.decisionId');
  if (!storage.correlationId)
    fail('MISSING_CORRELATION_ID', 'storage.correlationId is required', 'storage.correlationId');
  if (!storage.nonce) fail('MISSING_NONCE', 'storage.nonce is required', 'storage.nonce');
  if (storage.expiresAt == null)
    fail('MISSING_EXPIRES_AT', 'storage.expiresAt is required', 'storage.expiresAt');
  if (!storage.sessionId)
    fail('MISSING_SESSION_ID', 'storage.sessionId is required', 'storage.sessionId');
  if (!storage.sourceHostId)
    fail('MISSING_SOURCE_HOST_ID', 'storage.sourceHostId is required', 'storage.sourceHostId');
  if (!storage.storageIntentFingerprint) {
    fail(
      'MISSING_STORAGE_INTENT_FINGERPRINT',
      'storage.storageIntentFingerprint is required',
      'storage.storageIntentFingerprint',
    );
  }

  // -----------------------------------------------------------------------
  // 4. Expiry check
  // -----------------------------------------------------------------------

  const now = host.clock.now();
  if (storage.expiresAt <= now) {
    fail(
      'HANDOFF_EXPIRED',
      `Storage handoff expired: expiresAt=${storage.expiresAt}, now=${now}`,
      'storage.expiresAt',
    );
  }

  // -----------------------------------------------------------------------
  // 5. Resource context document ID
  // -----------------------------------------------------------------------

  const resourceContext = storage.resourceContext;
  if (!resourceContext) {
    fail(
      'MISSING_RESOURCE_CONTEXT',
      'storage.resourceContext is required',
      'storage.resourceContext',
    );
  }
  if (!resourceContext.documentId) {
    fail(
      'MISSING_DOCUMENT_ID',
      'storage.resourceContext.documentId is required for storage-backed resources',
      'storage.resourceContext.documentId',
    );
  }
  const documentId = resourceContext.documentId;

  // -----------------------------------------------------------------------
  // 6. Document ref consistency
  // -----------------------------------------------------------------------

  const documentRef = storage.documentRef;
  if (documentRef) {
    if (documentRef.kind === 'document' && documentRef.documentId !== documentId) {
      fail(
        'DOCUMENT_REF_MISMATCH',
        `documentRef.documentId '${documentRef.documentId}' does not match resourceContext.documentId '${documentId}'`,
        'storage.documentRef.documentId',
      );
    }
    if (documentRef.kind === 'source-handle' && documentRef.resourceContext) {
      if (
        documentRef.resourceContext.documentId &&
        documentRef.resourceContext.documentId !== documentId
      ) {
        fail(
          'SOURCE_HANDLE_DOCUMENT_MISMATCH',
          `source-handle documentRef.resourceContext.documentId '${documentRef.resourceContext.documentId}' does not match '${documentId}'`,
          'storage.documentRef.resourceContext.documentId',
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // 7. Session ID consistency
  // -----------------------------------------------------------------------

  if (storage.sessionId !== host.session.sessionId) {
    fail(
      'SESSION_ID_MISMATCH',
      `storage.sessionId '${storage.sessionId}' does not match session.sessionId '${host.session.sessionId}'`,
      'storage.sessionId',
    );
  }

  // -----------------------------------------------------------------------
  // 8. Principal consistency: structural or fingerprint match
  // -----------------------------------------------------------------------

  if (!principalsStructurallyMatch(storage.principal, host.principal)) {
    const storagePrincipalFp = createHostCanonicalFingerprint(storage.principal);
    const hostPrincipalFp = createHostCanonicalFingerprint(host.principal);
    if (storagePrincipalFp !== hostPrincipalFp) {
      fail(
        'PRINCIPAL_MISMATCH',
        `storage.principal does not match host.principal (structural and fingerprint mismatch)`,
        'storage.principal',
      );
    }
  }

  // -----------------------------------------------------------------------
  // 9. Tenant/workspace marker consistency
  // -----------------------------------------------------------------------

  // Session ↔ Principal
  if (!tenantMarkersMatch(host.session.tenantId, host.principal.tenantId)) {
    fail(
      'TENANT_SESSION_PRINCIPAL_MISMATCH',
      `session.tenantId ${formatTenant(host.session.tenantId)} does not match principal.tenantId ${formatTenant(host.principal.tenantId)}`,
      'session.tenantId',
    );
  }
  if (!workspaceMarkersMatch(host.session.workspaceId, host.principal.workspaceId)) {
    fail(
      'WORKSPACE_SESSION_PRINCIPAL_MISMATCH',
      `session.workspaceId ${formatWorkspace(host.session.workspaceId)} does not match principal.workspaceId ${formatWorkspace(host.principal.workspaceId)}`,
      'session.workspaceId',
    );
  }

  // Session ↔ Resource context
  if (!tenantMarkersMatch(host.session.tenantId, resourceContext.tenantId)) {
    fail(
      'TENANT_SESSION_RESOURCE_MISMATCH',
      `session.tenantId ${formatTenant(host.session.tenantId)} does not match resourceContext.tenantId ${formatTenant(resourceContext.tenantId)}`,
      'storage.resourceContext.tenantId',
    );
  }
  if (!workspaceMarkersMatch(host.session.workspaceId, resourceContext.workspaceId)) {
    fail(
      'WORKSPACE_SESSION_RESOURCE_MISMATCH',
      `session.workspaceId ${formatWorkspace(host.session.workspaceId)} does not match resourceContext.workspaceId ${formatWorkspace(resourceContext.workspaceId)}`,
      'storage.resourceContext.workspaceId',
    );
  }

  // Validate authorized provider scopes match
  if (storage.authorizedProviders) {
    for (const provider of storage.authorizedProviders) {
      if (provider.storageScope) {
        if (!tenantMarkersMatch(provider.storageScope.tenantId, host.session.tenantId)) {
          fail(
            'TENANT_PROVIDER_SCOPE_MISMATCH',
            `Provider '${provider.providerRefId}' storageScope.tenantId ${formatTenant(provider.storageScope.tenantId)} does not match session.tenantId ${formatTenant(host.session.tenantId)}`,
            `storage.authorizedProviders[${provider.providerRefId}].storageScope.tenantId`,
          );
        }
        if (!workspaceMarkersMatch(provider.storageScope.workspaceId, host.session.workspaceId)) {
          fail(
            'WORKSPACE_PROVIDER_SCOPE_MISMATCH',
            `Provider '${provider.providerRefId}' storageScope.workspaceId ${formatWorkspace(provider.storageScope.workspaceId)} does not match session.workspaceId ${formatWorkspace(host.session.workspaceId)}`,
            `storage.authorizedProviders[${provider.providerRefId}].storageScope.workspaceId`,
          );
        }
      }
    }
  }

  // Document ref resource context tenant/workspace
  if (documentRef && documentRef.kind === 'source-handle' && documentRef.resourceContext) {
    if (!tenantMarkersMatch(documentRef.resourceContext.tenantId, host.session.tenantId)) {
      fail(
        'TENANT_DOC_REF_RESOURCE_MISMATCH',
        `documentRef.resourceContext.tenantId ${formatTenant(documentRef.resourceContext.tenantId)} does not match session.tenantId ${formatTenant(host.session.tenantId)}`,
        'storage.documentRef.resourceContext.tenantId',
      );
    }
    if (!workspaceMarkersMatch(documentRef.resourceContext.workspaceId, host.session.workspaceId)) {
      fail(
        'WORKSPACE_DOC_REF_RESOURCE_MISMATCH',
        `documentRef.resourceContext.workspaceId ${formatWorkspace(documentRef.resourceContext.workspaceId)} does not match session.workspaceId ${formatWorkspace(host.session.workspaceId)}`,
        'storage.documentRef.resourceContext.workspaceId',
      );
    }
  }

  // -----------------------------------------------------------------------
  // 10. single-tenant / no-workspace are exact markers, not wildcards
  // -----------------------------------------------------------------------

  // Validate that if one side is a string and the other is a marker, they don't match
  // (this is already handled by tenantMarkersMatch/workspaceMarkersMatch, but let's be explicit)
  if (
    (isSingleTenantMarker(host.session.tenantId) && typeof host.principal.tenantId === 'string') ||
    (typeof host.session.tenantId === 'string' && isSingleTenantMarker(host.principal.tenantId))
  ) {
    fail(
      'TENANT_MARKER_TYPE_MISMATCH',
      `Tenant markers must be the same type: string vs single-tenant marker`,
      'session.tenantId',
    );
  }
  if (
    (isNoWorkspaceMarker(host.session.workspaceId) &&
      typeof host.principal.workspaceId === 'string') ||
    (typeof host.session.workspaceId === 'string' &&
      isNoWorkspaceMarker(host.principal.workspaceId))
  ) {
    fail(
      'WORKSPACE_MARKER_TYPE_MISMATCH',
      `Workspace markers must be the same type: string vs no-workspace marker`,
      'session.workspaceId',
    );
  }

  // -----------------------------------------------------------------------
  // 11. Timezone consistency
  // -----------------------------------------------------------------------

  if (host.session.userTimezone !== host.timezone.userTimezone) {
    fail(
      'TIMEZONE_MISMATCH',
      `session.userTimezone '${host.session.userTimezone}' does not match timezone.userTimezone '${host.timezone.userTimezone}'`,
      'timezone.userTimezone',
    );
  }

  if (host.timezone.processTimezoneMayBeUsed !== false) {
    fail(
      'PROCESS_TIMEZONE_FORBIDDEN',
      'timezone.processTimezoneMayBeUsed must be false on host-backed paths',
      'timezone.processTimezoneMayBeUsed',
    );
  }

  // -----------------------------------------------------------------------
  // 12. Runtime kind support
  // -----------------------------------------------------------------------

  const runtimeKind = host.runtime.kind;
  if (!SUPPORTED_RUNTIME_KINDS.has(runtimeKind)) {
    fail(
      'UNSUPPORTED_RUNTIME',
      `Runtime kind '${runtimeKind}' is not supported in this runtime build. Supported: ${[...SUPPORTED_RUNTIME_KINDS].join(', ')}`,
      'runtime.kind',
    );
  }

  // -----------------------------------------------------------------------
  // 13. Transport binding for runtime kind
  // -----------------------------------------------------------------------

  if (!bindings.transportBindings.has(runtimeKind)) {
    fail(
      'MISSING_TRANSPORT_BINDING',
      `No transport binding registered for runtime kind '${runtimeKind}'`,
      'bindings.transportBindings',
    );
  }
  let transportBinding: ReturnType<typeof bindings.transportBindings.resolve>;
  try {
    transportBinding = bindings.transportBindings.resolve(runtimeKind);
  } catch (err) {
    fail(
      'TRANSPORT_BINDING_RESOLVE_FAILED',
      `Transport binding resolution failed for runtime kind '${runtimeKind}': ${err instanceof Error ? err.message : String(err)}`,
      'bindings.transportBindings',
    );
  }
  if (!transportBinding || transportBinding.runtimeKind !== runtimeKind) {
    fail(
      'TRANSPORT_BINDING_MISMATCH',
      `Transport binding for runtime kind '${runtimeKind}' resolved to '${transportBinding?.runtimeKind ?? '<missing>'}'`,
      'bindings.transportBindings',
    );
  }
  const transportConfig = transportBinding.createTransportConfig();
  const transportKind =
    transportConfig && typeof transportConfig === 'object'
      ? (transportConfig as { kind?: unknown }).kind
      : undefined;
  if (transportKind !== RUNTIME_TRANSPORT_KIND[runtimeKind]) {
    fail(
      'TRANSPORT_BINDING_CONFIG_MISMATCH',
      `Transport binding for runtime kind '${runtimeKind}' must return kind '${RUNTIME_TRANSPORT_KIND[runtimeKind]}', got '${String(transportKind)}'`,
      'bindings.transportBindings',
    );
  }

  // -----------------------------------------------------------------------
  // 14. Storage config safety: no raw secrets, tokens, URLs, paths, callbacks, bytes
  // -----------------------------------------------------------------------

  if (storage.storage) {
    const forbiddenResult = containsForbiddenConfigValues(storage.storage, 'storage.storage');
    if (forbiddenResult) {
      fail(
        'STORAGE_CONFIG_CONTAINS_FORBIDDEN',
        `DocumentStorageConfig contains forbidden content: ${forbiddenResult}`,
        'storage.storage',
      );
    }
  }

  // -----------------------------------------------------------------------
  // 15. Provider config ↔ authorizedProviders join
  // -----------------------------------------------------------------------

  const authorizedProviders = storage.authorizedProviders ?? [];

  if (
    storage.storage &&
    storage.storage.durability !== 'ephemeral' &&
    authorizedProviders.length === 0
  ) {
    fail(
      'DURABLE_STORAGE_NO_AUTHORIZED_PROVIDERS',
      `Durable storage handoff (durability=${storage.storage.durability}) requires at least one authorized provider`,
      'storage.authorizedProviders',
    );
  }

  if (storage.storage && storage.storage.providers) {
    const authorizedProviderMap = new Map(authorizedProviders.map((p) => [p.providerRefId, p]));
    const configProviderRefIds = new Set<string>();

    for (const configProvider of storage.storage.providers) {
      if (!configProvider.providerRefId) {
        fail(
          'PROVIDER_REF_ID_MISSING',
          `Storage provider (kind=${configProvider.kind}, role=${configProvider.role}) is missing providerRefId`,
          `storage.storage.providers[${configProvider.kind}:${configProvider.role}].providerRefId`,
        );
      }
      configProviderRefIds.add(configProvider.providerRefId);

      const authorized = authorizedProviderMap.get(configProvider.providerRefId);
      if (!authorized) {
        fail(
          'PROVIDER_NOT_AUTHORIZED',
          `Storage provider '${configProvider.providerRefId}' has no matching authorizedProviders entry`,
          `storage.storage.providers[${configProvider.providerRefId}]`,
        );
      }
      // Join validation: kind and role must match
      if (authorized.kind !== configProvider.kind) {
        fail(
          'PROVIDER_KIND_MISMATCH',
          `Provider '${configProvider.providerRefId}' kind mismatch: config=${configProvider.kind}, authorized=${authorized.kind}`,
          `storage.storage.providers[${configProvider.providerRefId}].kind`,
        );
      }
      if (authorized.role !== configProvider.role) {
        fail(
          'PROVIDER_ROLE_MISMATCH',
          `Provider '${configProvider.providerRefId}' role mismatch: config=${configProvider.role}, authorized=${authorized.role}`,
          `storage.storage.providers[${configProvider.providerRefId}].role`,
        );
      }
      if (authorized.authorityRef !== configProvider.authorityRef) {
        fail(
          'PROVIDER_AUTHORITY_REF_MISMATCH',
          `Provider '${configProvider.providerRefId}' authorityRef mismatch: config=${configProvider.authorityRef ?? '<none>'}, authorized=${authorized.authorityRef ?? '<none>'}`,
          `storage.storage.providers[${configProvider.providerRefId}].authorityRef`,
        );
      }
      if (
        canonicalJsonStringify(normalizeStorageScope(authorized.storageScope)) !==
        canonicalJsonStringify(normalizeStorageScope(configProvider.storageScope))
      ) {
        fail(
          'PROVIDER_STORAGE_SCOPE_MISMATCH',
          `Provider '${configProvider.providerRefId}' storageScope does not match authorized storage scope`,
          `storage.storage.providers[${configProvider.providerRefId}].storageScope`,
        );
      }
      if (authorized.redactedConfigFingerprint !== configProvider.redactedConfigFingerprint) {
        fail(
          'PROVIDER_REDACTED_CONFIG_FINGERPRINT_MISMATCH',
          `Provider '${configProvider.providerRefId}' redactedConfigFingerprint mismatch`,
          `storage.storage.providers[${configProvider.providerRefId}].redactedConfigFingerprint`,
        );
      }
    }

    for (const authorized of authorizedProviders) {
      if (
        authorized.required &&
        authorized.role !== 'exportSink' &&
        !configProviderRefIds.has(authorized.providerRefId)
      ) {
        fail(
          'REQUIRED_PROVIDER_UNMATCHED',
          `Required authorized provider '${authorized.providerRefId}' (kind=${authorized.kind}, role=${authorized.role}) has no matching storage config entry`,
          `storage.authorizedProviders[${authorized.providerRefId}]`,
        );
      }
    }
  }

  // -----------------------------------------------------------------------
  // 16. Provider materializer and source resolver capability checks
  // -----------------------------------------------------------------------

  const providerMaterializersAvailable: string[] = [];
  if (authorizedProviders) {
    for (const provider of authorizedProviders) {
      const materializerRequired =
        provider.role !== 'exportSink' &&
        (provider.required || (storage.storage?.durability ?? 'ephemeral') !== 'ephemeral');
      if (materializerRequired) {
        if (!bindings.providerMaterializers.has(provider.providerRefId)) {
          fail(
            'MISSING_PROVIDER_MATERIALIZER',
            `Provider '${provider.providerRefId}' (kind=${provider.kind}, role=${provider.role}) requires a materializer in bindings`,
            `bindings.providerMaterializers[${provider.providerRefId}]`,
          );
        }
      }
      if (bindings.providerMaterializers.has(provider.providerRefId)) {
        providerMaterializersAvailable.push(provider.providerRefId);
      }
    }
  }

  // Import requires a source-handle resolver
  const sourceResolversAvailable: string[] = [];
  if (operation === 'import') {
    if (!documentRef || documentRef.kind !== 'source-handle') {
      fail(
        'IMPORT_MISSING_SOURCE_HANDLE',
        `Import operation requires a source-handle document ref`,
        'storage.documentRef',
      );
    }
    const sourceKind = documentRef.sourceKind;
    if (!bindings.sourceHandleResolvers.has(sourceKind)) {
      fail(
        'IMPORT_MISSING_SOURCE_RESOLVER',
        `Import operation requires a source handle resolver for source kind '${sourceKind}', none registered`,
        `bindings.sourceHandleResolvers[${sourceKind}]`,
      );
    }
    sourceResolversAvailable.push(sourceKind);
  }

  // -----------------------------------------------------------------------
  // 17. Replay registry consumption (atomic, before engine construction)
  // -----------------------------------------------------------------------

  const principalFingerprint = createHostCanonicalFingerprint(host.principal);
  const resourceContextFingerprint = createHostCanonicalFingerprint(resourceContext);

  const replayConsumed = bindings.replayRegistry.consumeOnce({
    sourceHostId: storage.sourceHostId,
    sessionId: storage.sessionId,
    decisionId: storage.decisionId,
    operation: storage.operation,
    nonce: storage.nonce,
    resourceFingerprint: resourceContextFingerprint,
  });
  if (!replayConsumed) {
    fail(
      'REPLAY_PROTECTION_FAILED',
      `Handoff replay protection failed: nonce '${storage.nonce}' for decision '${storage.decisionId}' was already consumed or is invalid`,
      'storage.nonce',
    );
  }

  // -----------------------------------------------------------------------
  // 18. Build validated output
  // -----------------------------------------------------------------------

  const validatedStorage: ValidatedAuthorizedStorageHandoff = {
    handoff: storage,
    validatedAt: now,
    documentId,
  };

  const validatedRuntime: ValidatedKernelRuntimeConfig = {
    config: host.runtime,
    transportBindingVerified: true,
    transportBinding,
    transportConfig,
  };

  const validatedBindings: ValidatedHostKernelAdapterBindings = {
    bindings,
    providerMaterializersAvailable,
    sourceResolversAvailable,
  };

  const operationAuthorization: BoundHostDocumentOperationAuthorization = {
    sessionId: host.session.sessionId,
    principalFingerprint,
    resourceContextFingerprint,
    sourceHostId: storage.sourceHostId,
    diagnostics: host.diagnostics,
    replayRegistry: bindings.replayRegistry,
    documentAuthorization: host.documentAuthorization,
  };

  // -----------------------------------------------------------------------
  // 19. Emit success diagnostic
  // -----------------------------------------------------------------------

  host.diagnostics.emit({
    kind: 'hostConstruction.invalid' as const,
    code: 'HOST_VALIDATION_SUCCESS',
    phase: 'kernel-context',
    invariant: 'all-checks-passed',
    reason: `Host context validation passed for document '${documentId}', operation '${operation}'`,
    correlationId,
    decisionId,
    sourceHostId,
    timestamp: Date.now(),
  });

  return {
    kind: 'host-backed-document',
    documentId,
    operation,
    session: { ...host.session },
    resourceContext,
    documentRef: documentRef ?? undefined,
    principal: host.principal,
    storage: validatedStorage,
    runtime: validatedRuntime,
    diagnostics: host.diagnostics,
    clock: host.clock,
    timezone: host.timezone,
    workbookLinkResolver: host.workbookLinkResolver,
    bindings: validatedBindings,
    operationAuthorization,
  };
}
