/**
 * Host-backed import source-handle validation and resolution.
 *
 * Import source bytes are NEVER passed through DocumentFactory options. They
 * are obtained exclusively through validated source-handle resolvers after:
 *   1. The source handle is validated (issuer, session, principal, expiry, …)
 *   2. The replay registry consumes the import nonce BEFORE materialization
 *   3. The trusted resolver materializes and verifies content identity
 *
 * If resolver support or identity verification is missing, import fails CLOSED
 * — no fallback to legacy raw byte options.
 */

import type { HostDiagnosticsSink } from '@mog-sdk/types-host/diagnostics';
import type { HostCanonicalFingerprint } from '@mog-sdk/types-host/fingerprints';
import {
  createHostByteFingerprint,
  createHostCanonicalFingerprint,
} from '@mog-sdk/types-host/fingerprints';
import type {
  HostDocumentRef,
  HostSourceContentIdentity,
  AuthorizedDocumentStorageHandoff,
} from '@mog-sdk/types-host/kernel';
import type {
  HostSourceHandleResolverRegistry,
  SourceHandleResolveRequest,
  HostHandoffReplayRegistry,
  HandoffReplayKey,
} from '@mog-sdk/types-host/bindings';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface ImportSourceValidationConfig {
  readonly documentRef: HostDocumentRef;
  readonly storage: AuthorizedDocumentStorageHandoff;
  readonly sourceHandleResolvers: HostSourceHandleResolverRegistry;
  readonly replayRegistry: HostHandoffReplayRegistry;
  readonly principalFingerprint: HostCanonicalFingerprint;
  readonly resourceContextFingerprint: HostCanonicalFingerprint;
  readonly diagnostics: HostDiagnosticsSink;
  readonly clock: { now(): number };
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ValidatedImportSource {
  readonly bytes: Uint8Array;
  readonly sourceHandleId: string;
  readonly sourceKind: string;
  readonly contentIdentity: HostSourceContentIdentity;
  readonly contentIdentityVerified: true;
}

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class ImportSourceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ImportSourceError';
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CORRELATION_ID = 'import-source-validation';

function emitDiagnostic(
  diagnostics: HostDiagnosticsSink,
  code: string,
  reason: string,
  clock: { now(): number },
): void {
  diagnostics.emit({
    kind: 'hostConstruction.invalid',
    correlationId: CORRELATION_ID,
    timestamp: clock.now(),
    code,
    phase: 'storage-handoff',
    invariant: 'import-source-handle-validation',
    reason,
  });
}

function emitSuccess(
  diagnostics: HostDiagnosticsSink,
  code: string,
  reason: string,
  clock: { now(): number },
): void {
  diagnostics.emit({
    kind: 'documentAuthorization.denied',
    correlationId: CORRELATION_ID,
    timestamp: clock.now(),
    code,
    operation: 'import',
    reason,
  });
}

type SourceHandleRef = Extract<HostDocumentRef, { readonly kind: 'source-handle' }>;

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJsonStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(obj[key])}`)
    .join(',')}}`;
}

function byteContentIdentity(bytes: Uint8Array): HostSourceContentIdentity {
  return {
    kind: 'immutable-byte-handle',
    handleFingerprint: createHostByteFingerprint(bytes),
    sizeBytes: bytes.byteLength,
  };
}

function contentIdentityEquals(
  a: HostSourceContentIdentity,
  b: HostSourceContentIdentity,
): boolean {
  return canonicalJsonStringify(a) === canonicalJsonStringify(b);
}

function resourceContextEquals(
  a: SourceHandleRef['resourceContext'],
  b: AuthorizedDocumentStorageHandoff['resourceContext'],
): boolean {
  return canonicalJsonStringify(a) === canonicalJsonStringify(b);
}

/**
 * Validate that all required fields are present on a source-handle document ref.
 */
function assertSourceHandleFields(ref: SourceHandleRef): void {
  const missing: string[] = [];
  if (!ref.sourceHandleId) missing.push('sourceHandleId');
  if (!ref.issuance) missing.push('issuance');
  if (!ref.sourceKind) missing.push('sourceKind');
  if (!ref.issuerHostId) missing.push('issuerHostId');
  if (!ref.sourceHostId) missing.push('sourceHostId');
  if (!ref.sourceSessionId) missing.push('sourceSessionId');
  if (!ref.principalFingerprint) missing.push('principalFingerprint');
  if (!ref.resourceContext) missing.push('resourceContext');
  if (ref.expiresAt == null) missing.push('expiresAt');
  if (ref.singleUse == null) missing.push('singleUse');

  if (missing.length > 0) {
    throw new ImportSourceError(
      'SOURCE_HANDLE_INVALID',
      `Source handle is missing required fields: ${missing.join(', ')}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main validation + resolution
// ---------------------------------------------------------------------------

export async function validateAndResolveImportSource(
  config: ImportSourceValidationConfig,
): Promise<ValidatedImportSource> {
  const {
    documentRef,
    sourceHandleResolvers,
    replayRegistry,
    principalFingerprint,
    resourceContextFingerprint,
    diagnostics,
    clock,
  } = config;

  // 1. Verify documentRef is a source-handle
  if (documentRef.kind !== 'source-handle') {
    const msg = `Expected documentRef.kind === 'source-handle', got '${documentRef.kind}'`;
    emitDiagnostic(diagnostics, 'NOT_SOURCE_HANDLE_REF', msg, clock);
    throw new ImportSourceError('NOT_SOURCE_HANDLE_REF', msg);
  }

  const ref = documentRef as SourceHandleRef;

  // 2. Validate required source handle fields
  try {
    assertSourceHandleFields(ref);
  } catch (err) {
    if (err instanceof ImportSourceError) {
      emitDiagnostic(diagnostics, err.code, err.message, clock);
    }
    throw err;
  }

  // 3. Check expiry
  if (ref.expiresAt <= clock.now()) {
    const msg = `Source handle expired at ${ref.expiresAt}, current time is ${clock.now()}`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_EXPIRED', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_EXPIRED', msg);
  }
  if (ref.issuance.expiresAt !== ref.expiresAt) {
    const msg = `Source handle expiry mismatch: ref.expiresAt '${ref.expiresAt}' does not match issuance.expiresAt '${ref.issuance.expiresAt}'`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_EXPIRY_MISMATCH', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_EXPIRY_MISMATCH', msg);
  }
  if (ref.issuerHostId !== ref.issuance.issuerHostId) {
    const msg = `Source handle issuer mismatch: ref.issuerHostId '${ref.issuerHostId}' does not match issuance.issuerHostId '${ref.issuance.issuerHostId}'`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_ISSUER_MISMATCH', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_ISSUER_MISMATCH', msg);
  }
  if (ref.sourceHostId !== config.storage.sourceHostId) {
    const msg = `Source handle host mismatch: expected '${config.storage.sourceHostId}', got '${ref.sourceHostId}'`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_WRONG_SOURCE_HOST', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_WRONG_SOURCE_HOST', msg);
  }
  if (ref.singleUse !== true) {
    const msg = `Source handle '${ref.sourceHandleId}' is not marked single-use`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_NOT_SINGLE_USE', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_NOT_SINGLE_USE', msg);
  }

  // 4. Check principal fingerprint
  if (ref.principalFingerprint !== principalFingerprint) {
    const msg = `Source handle principal fingerprint mismatch: expected '${principalFingerprint}', got '${ref.principalFingerprint}'`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_WRONG_PRINCIPAL', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_WRONG_PRINCIPAL', msg);
  }

  // 5. Check source session
  if (ref.sourceSessionId !== config.storage.sessionId) {
    const msg = `Source handle session mismatch: expected '${config.storage.sessionId}', got '${ref.sourceSessionId}'`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_WRONG_SESSION', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_WRONG_SESSION', msg);
  }
  if (!resourceContextEquals(ref.resourceContext, config.storage.resourceContext)) {
    const msg = `Source handle resource context does not match authorized storage handoff`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_RESOURCE_CONTEXT_MISMATCH', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_RESOURCE_CONTEXT_MISMATCH', msg);
  }

  // 6. Check resolver availability
  if (!sourceHandleResolvers.has(ref.sourceKind)) {
    const msg = `No source handle resolver registered for sourceKind '${ref.sourceKind}'`;
    emitDiagnostic(diagnostics, 'NO_RESOLVER_FOR_SOURCE_KIND', msg, clock);
    throw new ImportSourceError('NO_RESOLVER_FOR_SOURCE_KIND', msg);
  }

  // 7. Consume the storage handoff nonce BEFORE materialization.
  // The replay key is joined to the authoritative storage decision/nonce
  // rather than the source issuance alone, so a source handle cannot be
  // replayed under a different storage authorization.
  const replayKey: HandoffReplayKey = {
    sourceHostId: ref.sourceHostId,
    sessionId: ref.sourceSessionId,
    decisionId: config.storage.decisionId,
    operation: `import-source:${ref.sourceHandleId}`,
    nonce: config.storage.nonce,
    resourceFingerprint: resourceContextFingerprint,
  };

  const nonceConsumed = replayRegistry.consumeOnce(replayKey);
  if (!nonceConsumed) {
    const msg = `Source handle '${ref.sourceHandleId}' nonce already consumed (replay detected)`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_REUSED', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_REUSED', msg);
  }

  // 8. Resolve source handle through trusted resolver
  const request: SourceHandleResolveRequest = {
    sourceHandleId: ref.sourceHandleId,
    issuance: ref.issuance,
    expectedContentIdentity: ref.issuance.contentIdentity,
    sourceKind: ref.sourceKind,
    issuerHostId: ref.issuerHostId,
    sourceHostId: ref.sourceHostId,
    sourceSessionId: ref.sourceSessionId,
    resourceContext: ref.resourceContext,
    expiresAt: ref.expiresAt,
    singleUse: ref.singleUse,
    redactedFingerprint: ref.redactedFingerprint,
    principalFingerprint,
    resourceContextFingerprint,
    sessionId: ref.sourceSessionId,
    decisionId: config.storage.decisionId,
    nonce: config.storage.nonce,
  };

  const result = await sourceHandleResolvers.resolve(request);

  // 9. Verify content identity from resolver
  // Runtime check: the resolver must confirm content identity verification.
  // Even though the type says `contentIdentityVerified: true`, a misbehaving
  // resolver could return false at runtime — fail closed.
  if ((result as { contentIdentityVerified: boolean }).contentIdentityVerified !== true) {
    const msg = `Source resolver for '${ref.sourceKind}' did not verify content identity for source handle '${ref.sourceHandleId}'`;
    emitDiagnostic(diagnostics, 'CONTENT_IDENTITY_NOT_VERIFIED', msg, clock);
    throw new ImportSourceError('CONTENT_IDENTITY_NOT_VERIFIED', msg);
  }
  if (result.sourceHandleId !== ref.sourceHandleId) {
    const msg = `Source resolver for '${ref.sourceKind}' returned source handle '${result.sourceHandleId}' instead of '${ref.sourceHandleId}'`;
    emitDiagnostic(diagnostics, 'SOURCE_HANDLE_RESULT_MISMATCH', msg, clock);
    throw new ImportSourceError('SOURCE_HANDLE_RESULT_MISMATCH', msg);
  }

  if (!contentIdentityEquals(result.contentIdentity, ref.issuance.contentIdentity)) {
    const msg = `Source resolver for '${ref.sourceKind}' returned content identity that does not match issuance for source handle '${ref.sourceHandleId}'`;
    emitDiagnostic(diagnostics, 'CONTENT_IDENTITY_MISMATCH', msg, clock);
    throw new ImportSourceError('CONTENT_IDENTITY_MISMATCH', msg);
  }

  if (ref.issuance.contentIdentity.kind === 'immutable-byte-handle') {
    const actualIdentity = byteContentIdentity(result.bytes);
    if (!contentIdentityEquals(actualIdentity, ref.issuance.contentIdentity)) {
      const msg = `Source resolver for '${ref.sourceKind}' returned bytes that do not match issued immutable-byte-handle identity for source handle '${ref.sourceHandleId}'`;
      emitDiagnostic(diagnostics, 'CONTENT_BYTES_MISMATCH', msg, clock);
      throw new ImportSourceError('CONTENT_BYTES_MISMATCH', msg);
    }
  }

  // 10. Emit success diagnostic
  emitSuccess(
    diagnostics,
    'IMPORT_SOURCE_RESOLVED',
    `Source handle '${ref.sourceHandleId}' resolved successfully (kind: ${ref.sourceKind})`,
    clock,
  );

  // 11. Return validated import source
  return {
    bytes: result.bytes,
    sourceHandleId: ref.sourceHandleId,
    sourceKind: ref.sourceKind,
    contentIdentity: result.contentIdentity,
    contentIdentityVerified: true,
  };
}
