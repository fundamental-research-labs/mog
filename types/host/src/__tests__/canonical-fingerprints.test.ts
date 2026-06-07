import {
  canonicalJsonStringify,
  createHostByteFingerprint,
  createHostCanonicalFingerprint,
  sha256BytesHex,
  sha256Hex,
} from '../fingerprints';
import type { HostCanonicalFingerprint, HostCanonicalFingerprintProof } from '../fingerprints';
import type { VerifiedPrincipal } from '../identity';
import type {
  HostDocumentResourceContext,
  HostStorageAuthorizationIntent,
  HostDocumentRef,
  HostDocumentAuthorizationDetails,
  HostExportContentPolicy,
} from '../kernel';
import {
  createPrincipalFingerprintProof,
  createResourceContextFingerprintProof,
  createStorageIntentFingerprintProof,
  createDocumentRefFingerprintProof,
  createContentPolicyFingerprintProof,
  PRINCIPAL_COVERED_FIELDS,
  RESOURCE_CONTEXT_COVERED_FIELDS,
  STORAGE_INTENT_COVERED_FIELDS,
  DOCUMENT_REF_COVERED_FIELDS,
  CONTENT_POLICY_COVERED_FIELDS,
} from './fingerprint-helpers';

const FINGERPRINT_REGEX = /^mog-host-fp:v1:(sha256|blake3):[a-f0-9]{64}$/;

function assertValidProof(proof: HostCanonicalFingerprintProof) {
  expect(proof.version).toBe('v1');
  expect(['sha256', 'blake3']).toContain(proof.algorithm);
  expect(proof.canonicalization).toBe('jcs-rfc8785');
  expect(proof.digest).toMatch(FINGERPRINT_REGEX);
  expect(proof.coveredFields.length).toBeGreaterThan(0);
}

const TEST_PRINCIPAL: VerifiedPrincipal = {
  issuer: { issuerId: 'test-issuer', issuerKind: 'test' },
  subjectId: 'user-001',
  tenantId: 'tenant-abc',
  workspaceId: 'ws-xyz',
  actorKind: 'user',
  tags: ['editor', 'admin'],
};

const TEST_RESOURCE_CONTEXT: HostDocumentResourceContext = {
  tenantId: 'tenant-abc',
  workspaceId: 'ws-xyz',
  documentId: 'doc-001',
  resolutionSource: 'trusted-adapter',
};

const TEST_STORAGE_INTENT: HostStorageAuthorizationIntent = {
  openIntent: 'create',
  durability: 'ephemeral',
  rawBytesPolicy: {
    kind: 'trusted-raw-provider-boundary',
    boundary: 'test-fixture',
    rawProviderBytesMayReachUntrustedClient: false,
  },
  requestedConstraint: 'ephemeral',
  providers: [],
};

const TEST_DOCUMENT_REF_DOC: HostDocumentRef = {
  kind: 'document',
  documentId: 'doc-001',
};

const TEST_DOCUMENT_REF_SOURCE_HANDLE: HostDocumentRef = {
  kind: 'source-handle',
  sourceHandleId: 'sh-001',
  issuance: {
    source: 'trusted-source-handle-registry',
    issuanceId: 'iss-001',
    issuerHostId: 'host-001',
    contentIdentity: { kind: 'content-hash', algorithm: 'sha256', digest: 'abc123' },
    issuedAt: 1700000000000,
    expiresAt: 1700003600000,
  },
  sourceKind: 'file-url',
  issuerHostId: 'host-001',
  sourceHostId: 'host-001',
  sourceSessionId: 'sess-001',
  principalFingerprint:
    'mog-host-fp:v1:sha256:0000000000000000000000000000000000000000000000000000000000000000' as HostCanonicalFingerprint,
  resourceContext: TEST_RESOURCE_CONTEXT,
  expiresAt: 1700003600000,
  singleUse: true,
};

describe('Canonical fingerprint format', () => {
  it('uses real SHA-256 hex for canonical payloads', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(sha256BytesHex(new Uint8Array([0x61, 0x62, 0x63]))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(createHostCanonicalFingerprint({ b: 2, a: 1 })).toBe(
      `mog-host-fp:v1:sha256:${sha256Hex(canonicalJsonStringify({ a: 1, b: 2 }))}`,
    );
  });

  it('frames raw byte fingerprints without canonicalizing bytes as JSON arrays', () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);

    expect(createHostByteFingerprint(bytes)).toMatch(FINGERPRINT_REGEX);
    expect(createHostByteFingerprint(bytes)).toBe(createHostByteFingerprint(bytes.slice()));
    expect(createHostByteFingerprint(bytes)).not.toBe(
      createHostByteFingerprint(new Uint8Array([0, 1, 2, 3, 4])),
    );
  });

  it('matches the expected pattern mog-host-fp:v1:<algorithm>:<hex-digest>', () => {
    const proof = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    expect(proof.digest).toMatch(FINGERPRINT_REGEX);
  });

  it('produces 64-character hex digests for sha256', () => {
    const proof = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    const hex = proof.digest.split(':')[3];
    expect(hex).toHaveLength(64);
    expect(hex).toMatch(/^[a-f0-9]+$/);
  });
});

describe('Principal fingerprint', () => {
  it('produces a valid proof', () => {
    const proof = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    assertValidProof(proof);
  });

  it('covers the correct fields', () => {
    const proof = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    expect(proof.coveredFields).toEqual([...PRINCIPAL_COVERED_FIELDS]);
  });

  it('is deterministic for the same input', () => {
    const a = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    const b = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    expect(a.digest).toBe(b.digest);
  });

  it('changes when principal fields change', () => {
    const altered: VerifiedPrincipal = { ...TEST_PRINCIPAL, subjectId: 'user-002' };
    const original = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    const changed = createPrincipalFingerprintProof(altered);
    expect(original.digest).not.toBe(changed.digest);
  });

  it('is issued by test-fixture', () => {
    const proof = createPrincipalFingerprintProof(TEST_PRINCIPAL);
    expect(proof.issuedBy).toBe('test-fixture');
  });
});

describe('Resource context fingerprint', () => {
  it('produces a valid proof', () => {
    const proof = createResourceContextFingerprintProof(TEST_RESOURCE_CONTEXT);
    assertValidProof(proof);
  });

  it('covers the correct fields', () => {
    const proof = createResourceContextFingerprintProof(TEST_RESOURCE_CONTEXT);
    expect(proof.coveredFields).toEqual([...RESOURCE_CONTEXT_COVERED_FIELDS]);
  });

  it('is deterministic for the same input', () => {
    const a = createResourceContextFingerprintProof(TEST_RESOURCE_CONTEXT);
    const b = createResourceContextFingerprintProof(TEST_RESOURCE_CONTEXT);
    expect(a.digest).toBe(b.digest);
  });

  it('changes when context fields change', () => {
    const altered: HostDocumentResourceContext = {
      ...TEST_RESOURCE_CONTEXT,
      documentId: 'doc-002',
    };
    const original = createResourceContextFingerprintProof(TEST_RESOURCE_CONTEXT);
    const changed = createResourceContextFingerprintProof(altered);
    expect(original.digest).not.toBe(changed.digest);
  });
});

describe('Storage intent fingerprint', () => {
  it('produces a valid proof', () => {
    const proof = createStorageIntentFingerprintProof(TEST_STORAGE_INTENT);
    assertValidProof(proof);
  });

  it('covers the correct fields', () => {
    const proof = createStorageIntentFingerprintProof(TEST_STORAGE_INTENT);
    expect(proof.coveredFields).toEqual([...STORAGE_INTENT_COVERED_FIELDS]);
  });

  it('is deterministic for the same input', () => {
    const a = createStorageIntentFingerprintProof(TEST_STORAGE_INTENT);
    const b = createStorageIntentFingerprintProof(TEST_STORAGE_INTENT);
    expect(a.digest).toBe(b.digest);
  });

  it('changes when intent fields change', () => {
    const altered: HostStorageAuthorizationIntent = {
      ...TEST_STORAGE_INTENT,
      requestedConstraint: 'read-only',
    };
    const original = createStorageIntentFingerprintProof(TEST_STORAGE_INTENT);
    const changed = createStorageIntentFingerprintProof(altered);
    expect(original.digest).not.toBe(changed.digest);
  });
});

describe('Document ref fingerprint', () => {
  describe('kind: document', () => {
    it('produces a valid proof', () => {
      const proof = createDocumentRefFingerprintProof(TEST_DOCUMENT_REF_DOC);
      assertValidProof(proof);
    });

    it('covers the correct fields', () => {
      const proof = createDocumentRefFingerprintProof(TEST_DOCUMENT_REF_DOC);
      expect(proof.coveredFields).toEqual([...DOCUMENT_REF_COVERED_FIELDS.document]);
    });
  });

  describe('kind: source-handle', () => {
    it('produces a valid proof', () => {
      const proof = createDocumentRefFingerprintProof(TEST_DOCUMENT_REF_SOURCE_HANDLE);
      assertValidProof(proof);
    });

    it('covers the correct fields', () => {
      const proof = createDocumentRefFingerprintProof(TEST_DOCUMENT_REF_SOURCE_HANDLE);
      expect(proof.coveredFields).toEqual([...DOCUMENT_REF_COVERED_FIELDS['source-handle']]);
    });
  });

  it('produces different digests for document vs source-handle', () => {
    const docProof = createDocumentRefFingerprintProof(TEST_DOCUMENT_REF_DOC);
    const handleProof = createDocumentRefFingerprintProof(TEST_DOCUMENT_REF_SOURCE_HANDLE);
    expect(docProof.digest).not.toBe(handleProof.digest);
  });
});

describe('Content policy fingerprint', () => {
  const accessProof = {
    source: 'rust-policy-engine' as const,
    decisionId: 'dec-001',
    sessionId: 'sess-001',
    principalFingerprint:
      'mog-host-fp:v1:sha256:0000000000000000000000000000000000000000000000000000000000000000' as HostCanonicalFingerprint,
    resourceContextFingerprint:
      'mog-host-fp:v1:sha256:1111111111111111111111111111111111111111111111111111111111111111' as HostCanonicalFingerprint,
    target: 'workbook' as const,
    effectiveLevel: 'read' as const,
    correlationId: 'corr-001',
    issuedAt: 1700000000000,
  };

  const rawProof = {
    source: 'rust-policy-engine' as const,
    decisionId: 'dec-002',
    sessionId: 'sess-001',
    principalFingerprint:
      'mog-host-fp:v1:sha256:0000000000000000000000000000000000000000000000000000000000000000' as HostCanonicalFingerprint,
    resourceContextFingerprint:
      'mog-host-fp:v1:sha256:1111111111111111111111111111111111111111111111111111111111111111' as HostCanonicalFingerprint,
    target: 'raw-document-materialization' as const,
    scope: 'entire-document' as const,
    effectiveLevel: 'raw-materialize' as const,
    childPolicyResolution: 'all-materialized-targets-raw-authorized' as const,
    correlationId: 'corr-002',
    issuedAt: 1700000000000,
  };

  const redactedViewExport: Extract<
    HostDocumentAuthorizationDetails,
    { readonly operation: 'export' }
  > = {
    operation: 'export',
    format: 'xlsx',
    exportPathId: 'ep-001',
    documentHighWaterMark: {
      source: 'kernel-write-gate',
      proofId: 'hwm-001',
      registryId: 'reg-001',
      sessionId: 'sess-001',
      resourceContextFingerprint:
        'mog-host-fp:v1:sha256:1111111111111111111111111111111111111111111111111111111111111111' as HostCanonicalFingerprint,
      mutationWatermark: 'wm-001',
      exportPathId: 'ep-001',
      format: 'xlsx',
      contentPolicyFingerprint:
        'mog-host-fp:v1:sha256:2222222222222222222222222222222222222222222222222222222222222222' as HostCanonicalFingerprint,
      destination: 'download',
      requestedExportSinkRefs: [],
      issuedAt: 1700000000000,
      expiresAt: 1700003600000,
      coveredFields: [
        'proofId',
        'registryId',
        'sessionId',
        'resourceContextFingerprint',
        'mutationWatermark',
        'exportPathId',
        'format',
        'contentPolicyFingerprint',
        'destination',
        'requestedExportSinkRefs',
        'issuedAt',
        'expiresAt',
      ],
      canonicalPayloadHash:
        'mog-host-fp:v1:sha256:3333333333333333333333333333333333333333333333333333333333333333' as HostCanonicalFingerprint,
      verification: { kind: 'live-kernel-write-gate-registry', registryId: 'reg-001' },
    },
    destination: 'download',
    requestedExportSinkRefs: [],
    contentPolicy: {
      kind: 'redacted-view',
      workbookAccessProof: accessProof,
      redactionPath: 'rust-gated-redacted-export',
    },
  };

  const rawSnapshotExport: Extract<
    HostDocumentAuthorizationDetails,
    { readonly operation: 'export' }
  > = {
    ...redactedViewExport,
    contentPolicy: {
      kind: 'authorized-raw-snapshot',
      rawMaterializationProof: rawProof,
    },
  };

  describe('kind: redacted-view', () => {
    it('produces a valid proof', () => {
      const proof = createContentPolicyFingerprintProof(redactedViewExport);
      assertValidProof(proof);
    });

    it('covers the correct fields', () => {
      const proof = createContentPolicyFingerprintProof(redactedViewExport);
      expect(proof.coveredFields).toEqual([...CONTENT_POLICY_COVERED_FIELDS['redacted-view']]);
    });
  });

  describe('kind: authorized-raw-snapshot', () => {
    it('produces a valid proof', () => {
      const proof = createContentPolicyFingerprintProof(rawSnapshotExport);
      assertValidProof(proof);
    });

    it('covers the correct fields', () => {
      const proof = createContentPolicyFingerprintProof(rawSnapshotExport);
      expect(proof.coveredFields).toEqual([
        ...CONTENT_POLICY_COVERED_FIELDS['authorized-raw-snapshot'],
      ]);
    });
  });

  it('produces different digests for different content policy kinds', () => {
    const redacted = createContentPolicyFingerprintProof(redactedViewExport);
    const raw = createContentPolicyFingerprintProof(rawSnapshotExport);
    expect(redacted.digest).not.toBe(raw.digest);
  });
});

describe('Cross-kind fingerprint isolation', () => {
  it('principal and resource context fingerprints differ for overlapping field values', () => {
    const principal: VerifiedPrincipal = {
      issuer: { issuerId: 'test', issuerKind: 'test' },
      subjectId: 'sub',
      tenantId: 'tenant-abc',
      workspaceId: 'ws-xyz',
      actorKind: 'user',
      tags: [],
    };
    const ctx: HostDocumentResourceContext = {
      tenantId: 'tenant-abc',
      workspaceId: 'ws-xyz',
      resolutionSource: 'test-fixture',
    };
    const pProof = createPrincipalFingerprintProof(principal);
    const rProof = createResourceContextFingerprintProof(ctx);
    expect(pProof.digest).not.toBe(rProof.digest);
  });
});
